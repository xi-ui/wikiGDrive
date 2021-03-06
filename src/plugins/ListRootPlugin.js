'use strict';

import {BasePlugin} from './BasePlugin';
import {urlToFolderId} from '../google/GoogleDriveService';

export class ListRootPlugin extends BasePlugin {
  constructor(eventBus) {
    super(eventBus);

    eventBus.on('main:init', async (params) => {
      this.command = params.command;
      this.drive_id = params.drive_id;
    });
    eventBus.on('drive_config:loaded', (drive_config) => {
      this.drive_config = drive_config;
    });
    eventBus.on('files_structure:initialized', ({ filesStructure }) => {
      this.filesStructure = filesStructure;
    });
    eventBus.on('google_api:initialized', ({ auth, googleDriveService }) => {
      this.auth = auth;
      this.googleDriveService = googleDriveService;
    });
    eventBus.on('main:run_list_root', async () => {
      await this.start();
    });
  }

  async start() {
    const rootFolderId = urlToFolderId(this.drive_config['drive']);

    const context = { folderId: rootFolderId };
    if (this.drive_id) {
      context.driveId = this.drive_id;
    }

    let lastMTime = this.filesStructure.getMaxModifiedTime();

    try {
      const apiFiles = await this.googleDriveService.listRootRecursive(this.auth, context, lastMTime);
      const changedFiles = apiFiles.map(file => {
        if (file.parentId === rootFolderId) {
          file.parentId = undefined;
        }
        return file;
      });

      await this.filesStructure.merge(changedFiles);
    } catch (e) {
      this.eventBus.emit('panic', {
        message: e.message
      });
      return;
    }

    console.log('Listening Google Drive done');

    this.eventBus.emit('list_root:done', {
      context,
      lastMTime
    });
  }
}
