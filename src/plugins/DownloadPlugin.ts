'use strict';

import * as path from 'path';
import * as fs from 'fs';

import {BasePlugin} from './BasePlugin';
import {FilesStructure} from '../storage/FilesStructure';
import {FileService} from '../utils/FileService';
import {StringWritable} from '../utils/StringWritable';
import {GoogleDocsService} from '../google/GoogleDocsService';
import {GoogleDriveService} from '../google/GoogleDriveService';
import {ExternalFiles} from "../storage/ExternalFiles";
import {CliParams} from "../MainService";

export class DownloadPlugin extends BasePlugin {
  private googleDocsService: GoogleDocsService;
  private config_dir: string;
  private filesStructure: FilesStructure;
  private auth: any;
  private googleDriveService: GoogleDriveService;
  private externalFiles: ExternalFiles;
  private debug: string[];

  constructor(eventBus) {
    super(eventBus);

    this.googleDocsService = new GoogleDocsService();

    eventBus.on('main:init', async (params: CliParams) => {
      this.config_dir = params.config_dir;
      this.debug = params.debug;
    });
    eventBus.on('files_structure:initialized', ({ filesStructure }) => {
      this.filesStructure = filesStructure;
    });
    eventBus.on('external_files:initialized', ({ externalFiles }) => {
      this.externalFiles = externalFiles;
    });
    eventBus.on('google_api:initialized', ({ auth, googleDriveService }) => {
      this.auth = auth;
      this.googleDriveService = googleDriveService;
    });
    eventBus.on('files_structure:dirty', async () => {
      await this.handleDirtyFiles();
    });
    eventBus.on('download:process', async () => {
      await this.handleDirtyFiles();
    });
    eventBus.on('download:retry', async () => {
      await this.handleDirtyFiles();
    });
  }

  private async downloadAsset(file, targetPath) {
    console.log('Downloading asset: ' + file.localPath);
    await this.ensureDir(targetPath);

    try {
      const dest = fs.createWriteStream(targetPath);
      await this.googleDriveService.download(this.auth, file, dest);
    } catch (err) {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      throw err;
    }

    await this.filesStructure.  markClean([ file ]);
  }

  private async downloadDiagram(file, targetPath) {
    console.log('Downloading diagram: ' + file.localPath);
    await this.ensureDir(targetPath);

    // const svgTransform = new SvgTransform(this.linkTranslator, file.localPath);

    try {
      const writeStream = fs.createWriteStream(targetPath);
      await this.googleDriveService.exportDocument(
        this.auth,
        Object.assign({}, file, { mimeType: 'image/svg+xml' }),
        writeStream);
      // [svgTransform, writeStream]);
    } catch (err) {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      throw err;
    }

    try {
      const writeStreamPng = fs.createWriteStream(targetPath.replace(/.svg$/, '.png'));

      await this.googleDriveService.exportDocument(
        this.auth,
        Object.assign({}, file, { mimeType: 'image/png' }),
        writeStreamPng);
    } catch (err) {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      if (fs.existsSync(targetPath.replace(/.svg$/, '.png'))) fs.unlinkSync(targetPath.replace(/.svg$/, '.png'));
      throw err;
    }

    const fileService = new FileService();
    const md5Checksum = await fileService.md5File(targetPath.replace(/.svg$/, '.png'));

    await this.externalFiles.putFile({
      localPath: file.localPath.replace(/.svg$/, '.png'),
      localDocumentPath: file.localPath,
      md5Checksum: md5Checksum
    });
    await this.filesStructure.markClean([ file ]);
  }

  private async downloadDocument(file) {
    await this.ensureDir(path.join(this.config_dir, 'files', file.id + '.html'));

    const htmlPath = path.join(this.config_dir, 'files', file.id + '.html');
    const gdocPath = path.join(this.config_dir, 'files', file.id + '.gdoc');

    try {
      const destHtml = new StringWritable();
      const destJson = new StringWritable();

      await this.googleDriveService.exportDocument(this.auth, { id: file.id, mimeType: 'text/html', localPath: file.localPath }, destHtml);
      await this.googleDocsService.download(this.auth, file, destJson);

      fs.writeFileSync(htmlPath, destHtml.getString());
      fs.writeFileSync(gdocPath, destJson.getString());
      await this.filesStructure.markClean([ file ]);
    } catch (err) {
      if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
      if (fs.existsSync(gdocPath)) fs.unlinkSync(gdocPath);
      await this.filesStructure.markDirty([ file ]);
      throw err;
    }
  }

  private async handleDirtyFiles() {
    if (!fs.existsSync(path.join(this.config_dir, 'files'))) {
      fs.mkdirSync(path.join(this.config_dir, 'files'), { recursive: true });
    }

    const promises = [];
    const dirtyFiles = this.filesStructure.findFiles(item => !!item.dirty);

    if (dirtyFiles.length > 0) {
      console.log('Downloading modified files (' + dirtyFiles.length + ')');
    }

    for (const file of dirtyFiles) {
      const targetPath = path.join(this.config_dir, 'files', file.id + '.gdoc');

      if (file.mimeType === FilesStructure.CONFLICT_MIME) {
        promises.push(this.filesStructure.markClean([ file ]));
      } else
      if (file.mimeType === FilesStructure.REDIRECT_MIME) {
        promises.push(this.filesStructure.markClean([ file ]));
      } else
      if (file.mimeType === FilesStructure.DRAWING_MIME) {
        promises.push(this.downloadDiagram(file, targetPath));
      } else
      if (file.mimeType === FilesStructure.DOCUMENT_MIME) {
        promises.push(this.downloadDocument(file));
      } else
      if (file.size !== undefined) {
        promises.push(this.downloadAsset(file, targetPath));
      }
    }

    try {
      await Promise.allSettled(promises);
    } catch (ignore) { /* eslint-disable-line no-empty */
    }

    const dirtyFilesAfter = this.filesStructure.findFiles(item => !!item.dirty);
    if (dirtyFilesAfter.length > 0) {
      if (this.debug.indexOf('download') > -1) {
        console.log('dirtyFilesAfter', dirtyFilesAfter);
      }
      console.log('Download retry required');
      process.nextTick(() => {
        this.eventBus.emit('download:retry');
      });
    } else {
      this.eventBus.emit('download:clean');
    }
  }

  private async ensureDir(filePath) {
    const parts = filePath.split(path.sep);
    if (parts.length < 2) {
      return;
    }
    parts.pop();

    if (!fs.existsSync(parts.join(path.sep))) {
      fs.mkdirSync(parts.join(path.sep), { recursive: true });
    }
  }

}
