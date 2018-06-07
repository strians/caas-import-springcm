const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const winston = require('winston');
const SpringCM = require('springcm-node-sdk');
const filter = require('./filter');

module.exports = (task, callback) => {
  /**
   * Connect to the SpringCM account with provided credentials, then scrape
   * files from each configured path.
   */

  winston.info('Executing task', task);

  var auth = _.get(task, 'auth');
  var springCm;

  async.waterfall([
    (callback) => {
      /**
       * Connect to SpringCM.
       */

      winston.info('Connecting to SpringCM with client ID', _.get(auth, 'clientId'));

      // Create SpringCM client
      springCm = new SpringCM(auth);

      // Connect
      springCm.connect(callback);
    },
    (callback) => {
      /**
       * For each path, get a directory listing of the remote directory.
       * Apply configured filters to that listing then queue up downloads.
       */

      async.eachSeries(_.get(task, 'paths'), (path, callback) => {
        var remote = _.get(path, 'remote');

        springCm.getDocuments(remote, (err, documents) => {
          // If there's an error scraping this directory, skip and continue
          if (err) {
            winston.error(err);

            return callback();
          }

          // Filter listed documents
          var included = filter(_.get(path, 'filter'), documents);

          winston.info('Found', included.length, 'document(s) to download');

          // Download each document and move to wastebin (delete by default)
          async.eachSeries(included, (doc, callback) => {
            springCm.downloadDocument(doc, fs.createWriteStream(doc.getUid() + '.pdf'), (err) => {
              if (err) {
                winston.error(err);
                return callback();
              }

              winston.info('Downloaded', doc.getName(), '-->', doc.getUid() + '.pdf');

              var wastebin = _.get(path, 'wastebin');

              // Import directory can't be wastebin
              if (wastebin && wastebin !== remote) {
                springCm.moveDocument(doc, wastebin, callback);
              } else {
                springCm.deleteDocument(doc, callback);
              }
            });
          }, callback);
        });
      }, callback);
    }
  ], (err) => {
    if (err) {
      winston.error(err);
    }

    // Disconnect from SpringCM if we have an active client
    if (springCm) {
      winston.info('Disconnecting from SpringCM');

      springCm.close(callback);
    } else {
      callback();
    }
  });
};
