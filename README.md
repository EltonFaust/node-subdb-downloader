# NodeJS subtitles downloader

This project use [SubDB](http://thesubdb.com "SubDB - a free subtitle database") to download subtitles

Works only with SubRip subtitle files (.srt)

## Requirements
 - node >= 8

## Instalation
Can be instaled globally via `npm i -g subdb-downloader` or used as a library.

## Globally usage

### Download all missing subtitles in directory
```sh
nsdbd download-all <directory> <language>
```

### Watch for directory changes (used to automaticaly download subtitles)
```sh
nsdbd watch-dir <directory> <language>
```

### List all SubDB available languages
```sh
nsdbd list-langs
```
