const fs             = require('fs');
const path           = require('path');
const md5            = require('md5');
const axios          = require('axios');
const find           = require('find');
const chokidar       = require('chokidar');
const detectEncoding = require('detect-character-encoding');
const { Observable } = require('rxjs');

const regList = {
    video: /\.(mp4|avi|mkv|mpeg)$/i,
    videoTorrent: /\.(mp4|avi|mkv|mpeg)\.part$/i,
    sub: /\.srt$/i,
};
const hashList = {};

const instance = axios.create(
    {
        // baseURL: 'http://sandbox.thesubdb.com/',
        baseURL: 'http://api.thesubdb.com/',
        headers: { 'User-Agent': 'SubDB/1.0 (NodeSubDownloader/1.0.0; https://github.com/EltonFaust/node-subdb-downloader)' },
    }
);

const getDirFiles = (dir, exts) => {
    let files = find.fileSync(regList[exts], dir);

    return files.map(file => path.resolve(file)).filter((v, i, a) => a.indexOf(v) === i).sort();
};

const getDirVideoFiles = (dir) => {
    return getDirFiles(dir, 'video');
    // return getDirFiles(dir, ['mp4', 'avi', 'mkv', 'mpeg']);
};

const getDirSubFiles = (dir) => {
    return getDirFiles(dir, 'sub');
    // return getDirFiles(dir, ['srt']);
};

const parseToTime = (value, hasOp) => {
    const match = /^(?<op>\+|\-|)(?<hour>\d{1,2}):(?<min>\d{1,2}):(?<sec>\d{1,2})(\,|\.)(?<mils>\d{1,3})/.exec(value);

    if (!match) {
        return false;
    }

    const { op, min, sec, mils, hour } = match.groups;

    const time = Date.parse(`1970-01-01T${('0' + hour).substr(-2)}:${('0' + min).substr(-2)}:${('0' + sec).substr(-2)}.${('00' + mils).substr(-3)}+00:00`);

    if (hasOp && op == '-') {
        return -time;
    }

    return time;
};

// hash = md5 -> first 64 bytes + last 64 bytes
const fileHash = (fileName) => {
    const resolvedFileName = path.resolve(fileName);

    if (typeof hashList[resolvedFileName] !== 'undefined') {
        return hashList[resolvedFileName];
    }

    try {
        const fd = fs.openSync(resolvedFileName, 'r');

        const readsize = 64 * 1024;
        const stats = fs.statSync(resolvedFileName);

        const bufferInitial = Buffer.alloc(readsize);
        const bufferfinal = Buffer.alloc(readsize);

        fs.readSync(fd, bufferInitial, 0, readsize, 0);
        fs.readSync(fd, bufferfinal, 0, readsize, stats.size - readsize);

        hashList[resolvedFileName] = md5(Buffer.concat([ bufferInitial, bufferfinal ], readsize * 2));

        fs.closeSync(fd);
    } catch(e) {
        hashList[resolvedFileName] = false;
    }

    return hashList[resolvedFileName];
};

// console.log(fileHash('./dexter.mp4'))
// ffd8d4aa68033dc03d1c8ef373b9028c
// process.exit(0);

const dirFilesHash = (dir) => {
    return getDirVideoFiles(dir).map(file => ({ hash: fileHash(file), fileBaseName: path.basename(file) }));
};

const fetchLangs = () => {
    return new Promise((resolve, reject) => {
        instance.get('', { params: { action: 'languages' } }).then(({ data }) => {
            resolve(data.split(','));
        }).catch(() => {
            reject(new Error('Can\'t fetch SubDB languages'));
        });
    });
};

const fetchLangsForFile = (file) => {
    return new Promise((resolve, reject) => {
        const hash = fileHash(file);

        instance.get('', { params: { action: 'search', hash } }).then(({ data }) => {
            resolve({ hash, langs: data.split(',') });
            // console.log(data.split(',').map(lang => ` - ${lang}`).join("\n"));
        }).catch(() => {
            reject(new Error('Not found'));
        });
    });
};

const downloadForFile = (fileName, language) => {
    return new Promise((resolve, reject) => {
        const file = path.resolve(fileName);
        const hash = fileHash(file);

        if (hash === false) {
            reject(new Error('Invalid hash'));
            return;
        }

        instance.get(
            '',
            {
                params: { action: 'download', hash, language },
                responseType: 'arraybuffer',
                responseEncoding: 'binary',
            }
        ).then(({ data, headers }) => {
            fs.writeFileSync(file.replace(/\.[a-z0-9]+$/, '.srt'), data.toString('binary'));
            resolve({ hash, file, fileBaseName: path.basename(file) });
        }).catch(() => {
            reject(new Error(`Subtitle not found for ${hash}`));
        });
    });
};

const downloadMissingIn = (dir, lang) => {
    return new Promise((resolve) => {
        const allVideo = getDirVideoFiles(dir);
        const allSub = getDirSubFiles(dir).map(file => file.replace(regList.sub, ''));

        const allVideoNoSub = allVideo.filter((file) => {
            return allSub.indexOf(file.replace(/\.[a-z0-9]+$/, '')) === -1;
        });

        const data = {
            success: [],
            failed: [],
        };

        const processItem = () => {
            const file = allVideoNoSub.shift();

            if (typeof file === 'undefined') {
                resolve(data);
                return;
            }

            downloadForFile(file, lang).then((info) => {
                data.success.push(info);
                processItem();
            }).catch((e) => {
                data.failed.push({ file, fileBaseName: path.basename(file), message: e.message });
                processItem();
            });
        };

        processItem();
    });
};

const watchDir = (baseDir, lang) => {
    return Observable.create((observer) => {
        const fileTimer = {};
        const torrentFiles = [];
        const dir = path.resolve(baseDir);

        const processFile = (event, filename) => {
            if (!regList.video.test(filename)) {
                if (regList.videoTorrent.test(filename)) {
                    // torrent file being downloaded
                    torrentFiles.push(filename.replace(/\.[a-z0-9]+$/i, ''));
                }

                return;
            }

            if (event == 'add' && torrentFiles.indexOf(filename) === -1 && fs.existsSync(filename.replace(/\.[a-z0-9]+$/i, '.srt'))) {
                // event "add" is called on initialized, ignore if already have a subtitle file
                return;
            }

            const fileBaseName = path.basename(filename);

            observer.next({ type: 'changed', filename, fileBaseName });

            if (typeof fileTimer[filename] !== 'undefined') {
                clearTimeout(fileTimer[filename]);
            }

            fileTimer[filename] = setTimeout(
                () => {
                    delete fileTimer[filename];
                    delete hashList[filename];

                    downloadForFile(filename, lang).then(({ hash, fileBaseName }) => {
                        observer.next({ type: 'downloaded', filename, fileBaseName, hash });
                    }).catch((e) => {
                        observer.next({ type: 'error', filename, fileBaseName, message: e.message });
                    });
                },
                2000
            );
        };

        chokidar.watch(dir, { ignored: /(^|[\/\\])\..|\.srt/, persistent: true })
            .on('add', (filename) => processFile('add', filename))
            .on('change', (filename) => processFile('add', filename));
    })
};

const ajustFiles = (files, value) => {
    return new Promise((resolve, reject) => {
        const filesList = files.map((file) => {
            if (regList.video.test(file)) {
                return path.resolve(file).replace(/\.[a-z0-9]+$/, '.srt');
            }

            return path.resolve(file);
        });

        const notFound = filesList.filter(file => !fs.existsSync(file));

        if (notFound.length > 0) {
            reject(new Error(`Files not found:\n${notFound.map(file => ` - ${file}`).join("\n")}`));
            return;
        }

        const inc = parseToTime(value, true);

        if (inc === false || inc === 0) {
            reject(new Error('Invalid incremental value'));
            return;
        }

        const finalList = [];

        filesList.forEach((file) => {
            let content = fs.readFileSync(file);
            const encoding = detectEncoding(content).encoding == 'ISO-8859-1' ? 'latin1' : 'utf8';
            content = fs.readFileSync(file, encoding).toString();

            finalList.push(
                {
                    file,
                    fileBaseName: path.basename(file),
                    encoding,
                }
            );

            fs.renameSync(file, file.replace(regList.sub, `.srt_${Date.now()}`));

            const matchAll = content.match(/\d{2}\:\d{2}\:\d{2}\,\d{3} \-\-> \d{2}\:\d{2}\:\d{2}\,\d{3}/g);

            if (inc > 0) {
                matchAll.reverse();
            }

            matchAll.forEach((item) => {
                const { initial, final } = /(?<initial>.*) \-\-> (?<final>.*)/.exec(item).groups;

                const initialStr = (new Date(Math.max(0, parseToTime(initial) + inc))).toISOString().substr(11, 12).replace(/\./, ',');
                const finalStr = (new Date(Math.max(0, parseToTime(final) + inc))).toISOString().substr(11, 12).replace(/\./, ',');

                content = content.replace(new RegExp(item), `${initialStr} --> ${finalStr}`);
            });

            fs.writeFileSync(file, content, { encoding });
        });

        resolve(finalList);
    });
};

const ajustFilesIn = (dir, value) => {
    return ajustFiles(getDirSubFiles(dir), value);
};

module.exports = {
    fileHash,
    dirFilesHash,
    fetchLangs,
    fetchLangsForFile,
    downloadForFile,
    downloadMissingIn,
    watchDir,
    ajustFiles,
    ajustFilesIn,
};
