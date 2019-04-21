#!/usr/bin/env node

const yargs = require('yargs');

const {
    fileHash,
    dirFilesHash,
    fetchLangs,
    fetchLangsForFile,
    downloadForFile,
    downloadMissingIn,
    watchDir,
    ajustFiles,
    ajustFilesIn,
} = require('../lib/index');

yargs
.command(
    'list-langs',
    'List all available langs',
    () => {},
    () => {
        fetchLangs().then((langs) => {
            console.log(langs.map(lang => ` - ${lang}`).join("\n"));
        }).catch(console.error);
    }
)
.command(
    'get-hash <file>',
    'Get a file hash',
    () => {},
    (argv) => {
        console.log(fileHash(argv.file));
    }
)
.command(
    'list-hashes <dir>',
    'List all dir file hashes',
    () => {},
    (argv) => {
        dirFilesHash(argv.dir).forEach(({ hash, fileBaseName }) => {
            console.log(`${hash} -> ${fileBaseName}`);
        });
    }
)
.command(
    'search-for <file>',
    'Search subtitles for file',
    () => {},
    (argv) => {
        fetchLangsForFile(argv.file).then(({ hash, langs }) => {
            console.log(`Languages found for hash "${hash}"`);
            console.log(langs.map(lang => ` - ${lang}`).join("\n"));
        }).catch(console.error);
    }
)
.command(
    'download-for <file> <lang>',
    'Download the subtitle for a specific file',
    () => {},
    (argv) => {
        downloadForFile(argv.file, argv.lang).then(({ hash }) => {
            console.log(`Downloaded - ${hash}`);
        }).catch((e) => {
            console.error(e.message);
        });
    }
)
.command(
    'download-all <dir> <lang>',
    'Download all missing subtitles in directory',
    () => {},
    (argv) => {
        downloadMissingIn(argv.dir, argv.lang).then(({ success, failed }) => {
            if (success.length > 0) {
                console.log(`Downloaded (${success.length})`);
                console.log(success.map(({ hash, fileBaseName }) => ` - ${hash} (${fileBaseName})`).join("\n"));
            }

            if (failed.length > 0) {
                console.log(`Failed download (${failed.length})`);
                console.log(failed.map(({ fileBaseName, message }) => ` - (${fileBaseName}) -> "${hash}"`).join("\n"));
            }
        });
    }
)
.command(
    'watch-dir <dir> <lang>',
    'Watch directory for video changes subtitles',
    () => {},
    (argv) => {
        watchDir(argv.dir, argv.lang);
    }
)
.command(
    'ajust-file <file> <value>',
    'Increment time on srt files (+00:00:00,000)',
    () => {},
    (argv) => {
        ajustFiles([argv.file], argv.value).then(([{ fileBaseName, encoding }]) => {
            console.log(`${fileBaseName} -> ${encoding}`);
        }).catch(console.error);
    }
)
.command(
    'ajust-files-in <dir> <value>',
    'Increment time on all srt files (+00:00:00,000)',
    () => {},
    (argv) => {
        ajustFilesIn(argv.dir, argv.value).then((list) => {
            console.log(`Ajusted (${list.length})`)
            console.log(list.map(({ fileBaseName, encoding }) => ` - ${fileBaseName} -> ${encoding}`).join("\n"));
        }).catch(console.error);
    }
)
.demandCommand()
.help()
.argv;
