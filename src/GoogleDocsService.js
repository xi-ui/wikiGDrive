'use strict';

const {google} = require('googleapis');
import {MarkDownConverter} from "./MarkDownConverter";

export class GoogleDocsService {

  async download(auth, file, dest, fileMap) {
    return new Promise((resolve, reject) => {
      const docs = google.docs({version: 'v1', auth});

      docs.documents
        .get({
          documentId: file.id
        }, async (err, res) => {
          if (err) {
            reject(err);
          }

          const data = res.data;

          // console.log(JSON.stringify(data, null, 2))

          const converter = new MarkDownConverter(data, {
            fileMap
          });
          const md = converter.convert();

          dest.write(md);
          dest.end();

          resolve();
        });

    });

  }

}