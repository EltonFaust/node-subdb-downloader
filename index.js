#!/usr/bin/node

const fs             = require('fs');
const path           = require('path');
const md5            = require('md5');
const axios          = require('axios');
const yargs          = require('yargs')
const find           = require('find');
const detectEncoding = require('detect-character-encoding');
// const axios = require('md5');

const hashList = {};

// hash = md5 -> first 64 bytes + last 64 bytes
const fileHash = (fileName) => {
    const resolvedFileName = path.resolve(fileName);

    if (typeof hashList[resolvedFileName] !== 'undefined') {
        return hashList[resolvedFileName];
    }

    const fd = fs.openSync(resolvedFileName, 'r');

    const readsize = 64 * 1024;
    const stats = fs.statSync(resolvedFileName);

    const buffer = Buffer.alloc(readsize);
    const buffer2 = Buffer.alloc(readsize);

    fs.readSync(fd, buffer, 0, readsize, 0);
    fs.readSync(fd, buffer2, 0, readsize, stats.size - readsize);

    hashList[resolvedFileName] = md5(Buffer.concat([buffer, buffer2], readsize * 2));

    fs.closeSync(fd);

    return hashList[resolvedFileName];
};

const getDirFiles = (dir, exts) => {
    let files = [];

    if (typeof dir !== 'undefined' && exts && exts.length > 0) {
        files = files.concat(find.fileSync(new RegExp(`\\.(${exts.join('|')})$`, 'i'), dir));
    }

    return files.map(file => path.resolve(file)).filter((v, i, a) => a.indexOf(v) === i).sort();
};

const getDirVideoFiles = (dir) => {
    return getDirFiles(dir, ['mp4', 'avi', 'mkv', 'mpeg']);
};

const getDirSubFiles = (dir) => {
    return getDirFiles(dir, ['srt']);
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

// console.log(fileHash('./dexter.mp4'))
// ffd8d4aa68033dc03d1c8ef373b9028c
// process.exit(0);

const instance = axios.create(
    {
        // baseURL: 'http://sandbox.thesubdb.com/',
        baseURL: 'http://api.thesubdb.com/',
        headers: { 'User-Agent': 'SubDB/1.0 (NodeSubDownloader/1.0.0; https://github.com/EltonFaust/node-subtitles-downloader)' },
    }
);


yargs
.command(
    'list langs',
    'List all available langs',
    () => {},
    (argv) => {
        instance.get('', { params: { action: 'languages' } }).then(({ data }) => {
            console.log(data.split(',').map(lang => ` - ${lang}`).join("\n"));
        });
    }
)
.command(
    'get hash <file>',
    'Get a file hash',
    () => {},
    (argv) => {
        console.log(fileHash(argv.file));
        // console.log(fileHash2(argv.file));
    }
)
.command(
    'list hashes <dir>',
    'List all dir file hashes',
    () => {},
    (argv) => {
        getDirVideoFiles(argv.dir).forEach((file) => {
            console.log(`${fileHash(file)} -> ${path.basename(file)}`);
        });
    }
)
.command(
    'search for <file>',
    'Search subtitles for file',
    () => {},
    (argv) => {
        const hash = fileHash(argv.file);

        console.log(`${hash}`)

        instance.get('', { params: { action: 'search', hash } }).then(({ data }) => {
            console.log(data.split(',').map(lang => ` - ${lang}`).join("\n"));
        }).catch(() => {
            console.log(' - Not found');
        });
    }
)
.command(
    'download all <dir> <lang>',
    'Download all missing subtitles',
    () => {},
    (argv) => {
        const allVideo = getDirVideoFiles(argv.dir);
        const allSub = getDirSubFiles(argv.dir).map(file => file.replace(/\.srt+$/, ''));

        const allVideoNoSub = allVideo.filter((file) => {
            return allSub.indexOf(file.replace(/\.[a-z0-9]+$/, '')) === -1;
        });

        if (allVideoNoSub.length === 0) {
            console.log('No subtitles to download');
            return;
        }

        const processItem = () => {
            const file = allVideoNoSub.shift();

            if (typeof file === 'undefined') {
                return;
            }

            const hash = fileHash(file);

            console.log(`${hash} - ${path.basename(file)}`)

            instance.get('', { params: { action: 'download', hash, language: argv.lang } }).then(({ data }) => {
                fs.writeFileSync(file.replace(/\.[a-z0-9]+$/, '.srt'), data);
                console.log(' - Found');
                processItem();
            }).catch(() => {
                console.log(' - Not found');
                processItem();
            });
        };

        processItem();
    }
)
// .command(
//     'download <dir>',
//     'the serve command',
//     () => {},
//     (argv) => {
//         console.log('this command will be run by default')
//     }
// )
.command(
    'ajust files <dir> <value>',
    'Increment time on all srt files (+00:00:00,000)',
    () => {},
    (argv) => {
        const inc = parseToTime(argv.value, true);

        if (inc === false || inc == 0) {
            console.error('Invalid incremental value');
            return;
        }

        getDirSubFiles(argv.dir).forEach((file) => {
            let content = fs.readFileSync(file);
            const encoding = detectEncoding(content).encoding == 'ISO-8859-1' ? 'latin1' : 'utf8';
            content = fs.readFileSync(file, encoding).toString();

            console.log(`${path.basename(file)} -> ${encoding}`)

            fs.renameSync(file, file.replace(/\.srt/i, `.srt_${Date.now()}`));

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
    }
)
.demandCommand()
.help()
.argv;


// fileHash('./dexter.mp4').then((hash) => {
//     console.log(hash);
// });

// fileHash('./justified.mp4').then((hash) => {
//     console.log(hash);
// });



// instance.get('', { params: { action: 'download', hash: md5(bf1) } }).then(({ data }) => {
//     console.log(data);
// });
