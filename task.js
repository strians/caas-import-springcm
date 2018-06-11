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
        var recurse = _.get(path, 'recurse');

        var documentQueue = async.queue((doc, callback) => {
          async.waterfall([
            (callback) => {
              /**
               * Send request for the doc (listing doesn't include path)
               */

              springCm.getDocument(doc, callback);
            },
            (doc, callback) => {
              springCm.downloadDocument(doc, fs.createWriteStream(doc.getUid() + '.pdf'), (err) => {
                if (err) {
                  winston.error(err);
                  return callback();
                }

                winston.info('Downloaded', doc.getPath(), '-->', doc.getUid() + '.pdf');

                var wastebin = _.get(path, 'wastebin');

                // Import directory can't be wastebin
                if (wastebin && wastebin !== remote) {
                  springCm.moveDocument(doc, wastebin, callback);
                } else {
                  springCm.deleteDocument(doc, callback);
                }
              });
            }
          ], callback);
        });

        var folderQueue = async.queue((f, callback) => {
          var folder;

          async.waterfall([
            (callback) => {
              /**
               * Retrieve folder object (subfolders don't include paths)
               */

              springCm.getFolder(f, (err, res) => {
                if (err) {
                  return callback(err);
                }

                // Map to full folder object
                folder = res;

                callback();
              });
            },
            (callback) => {
              /**
               * Get a listing of documents in the folder and push them
               * into the document queue.
               */

              springCm.getDocuments(folder, (err, documents) => {
                if (err) {
                  return callback(err);
                }

                // Filter listed documents
                var included = filter(_.get(path, 'filter'), documents);

                winston.info('Found', included.length, 'document(s) in', folder.getPath(), 'to download');

                // Push each document in the document download queue
                _.each(included, doc => documentQueue.push(doc));

                callback();
              });
            },
            (callback) => {
              /**
               * If we're recursing through the remote directory, get
               * any subfolders and push them into the folder queue
               */

              if (recurse) {
                springCm.getSubfolders(folder, (err, folders) => {
                  if (err) {
                    return callback(err);
                  }

                  _.each(folders, folder => folderQueue.push(folder));

                  callback();
                });
              } else {
                callback();
              }
            }
          ], callback);
        });

        // Add to queue
        folderQueue.push(remote);

        // Wait for both queues to complete
        async.waterfall([
          (callback) => {
            if (folderQueue.length() > 0) {
              folderQueue.drain = callback;
            } else {
              callback();
            }
          },
          (callback) => {
            if (documentQueue.length() > 0) {
              documentQueue.drain = callback;
            } else {
              callback();
            }
          }
        ], callback);
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
