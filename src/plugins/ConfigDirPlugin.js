'use strict';

import fs from 'fs';
import path from 'path';

import {BasePlugin} from './BasePlugin';
import {FileService} from '../utils/FileService';

export class ConfigDirPlugin extends BasePlugin {

  constructor(eventBus) {
    super(eventBus);

    this.fileService = new FileService();
    // this.filePath = filePath;

    eventBus.on('start', async (params) => {
      await this.init(params);
      this.resolve();
    });
  }

  async initConfigDir(params) {
    if (fs.existsSync(params.config_dir)) {
      if (fs.lstatSync(params.config_dir).isDirectory()) {
        throw 'WikiGDrive already initialized.';
      } else {
        throw '.wikigdrive is not a directory';
      }
    }

    if (!params['drive']) {
      throw '--drive not specified';
    }

    if (!params['service_account'] && !params['client_id']) {
      throw 'service_account or client_id / client_id not specified';
    }

    const driveConfig = {
      drive: params['drive'],
      drive_id: params['drive_id'],
      dest: params['dest'],
      flat_folder_structure: !!params['flat-folder-structure'],
      link_mode: params['link_mode']
    };

    if (params['service_account']) {
      driveConfig.service_account = params['service_account'];
    } else {
      driveConfig.client_id = params['client_id'];
      driveConfig.client_secret = params['client_secret'];
    }

    fs.mkdirSync(params.config_dir, { recursive: true });
    fs.mkdirSync(path.join(params.config_dir, 'hooks'), { recursive: true });

    await this._saveConfig(path.join(params.config_dir, 'drive.json'), driveConfig);
  }

  async init(params) {
    switch (params.command) {
      case 'init':
        await this.initConfigDir(params);
        process.exit(0);
        return;
      default:
        await this.loadDriveConfig(params.config_dir);
        break;
    }
  }

  async loadDriveConfig(config_dir) {
    if (!fs.existsSync(config_dir)) {
      this.eventBus.emit('panic', {
        message: 'WikiGDrive not initialized. Run: wikigdrive init'
      });
    }
    if (!fs.lstatSync(config_dir).isDirectory()) {
      this.eventBus.emit('panic', {
        message: 'File .wikigdrive is not a directory. Perhaps running in 1.x version dir. Create new work directory.'
      });
    }

    const driveConfig = await this._loadConfig(path.join(config_dir, 'drive.json'));
    this.eventBus.emit('drive_config', driveConfig);
  }

  async _loadConfig(filePath) {
    try {
      const content = await this.fileService.readFile(filePath);
      const config = JSON.parse(content);
      return config;
    } catch (error) {
      return {};
    }
  }

  async _saveConfig(filePath, config) {
    const content = JSON.stringify(config, null, 2);
    return this.fileService.writeFile(filePath, content);
  }

}
