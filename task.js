const os = require('os');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const rimraf = require('rimraf');
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
  var springCm, tmpDir;

  async.waterfall([
    (callback) => {
      /**
       * Connect to SpringCM.
       */

      winston.info('Connecting to SpringCM', {
        clientId: _.get(auth, 'clientId'),
        dataCenter: _.get(auth, 'dataCenter')
      });

      // Create SpringCM client
      springCm = new SpringCM(auth);

      // Connect
      springCm.connect(callback);
    },
    (callback) => {
      /**
       * Create a temporary directory.
       */

      fs.mkdtemp(path.join(os.tmpdir(), 'caas-import-springcm-'), (err, folder) => {
        if (err) {
          return callback(err);
        }

        tmpDir = folder;

        winston.info('Creating temp directory', {
          directory: tmpDir
        });

        callback();
      });
    },
    (callback) => {
      /**
       * For each path, get a directory listing of the remote directory.
       * Apply configured filters to that listing then queue up downloads.
       */

      async.eachSeries(_.get(task, 'paths'), (pathConfig, callback) => {
        var remote = _.get(pathConfig, 'remote');
        var local = _.get(pathConfig, 'local');
        var recurse = _.get(pathConfig, 'recurse');

        var documentQueue = async.queue((doc, callback) => {
          var tmpPath, localPath;

          async.waterfall([
            (callback) => {
              /**
               * Send request for the doc (listing doesn't include path)
               */

              springCm.getDocument(doc, callback);
            },
            (doc, callback) => {
              var docNameFormat = task.nameFormat;
              var docName = `${doc.getUid()}.pdf`;

              if (docNameFormat) {
                var name = path.basename(doc.getName(), path.extname(doc.getName()));
                var formatted = docNameFormat.replace(/%UID%/g, doc.getUid())
                                             .replace(/%NAME%/g, name);
                docName = `${formatted}.pdf`;
              }

              tmpPath = path.join(tmpDir, docName);
              localPath = path.join(local, docName);

              springCm.downloadDocument(doc, fs.createWriteStream(tmpPath), (err) => {
                if (err) {
                  winston.error(err);
                  return callback();
                }

                winston.info('Downloaded document', {
                  remote: doc.getPath(),
                  local: tmpPath
                });

                var wastebin = _.get(pathConfig, 'wastebin');

                // Import directory can't be wastebin
                if (wastebin && wastebin !== remote) {
                  springCm.moveDocument(doc, wastebin, (err) => callback(err));
                } else {
                  springCm.deleteDocument(doc, callback);
                }
              });
            },
            (callback) => {
              fs.copyFile(tmpPath, localPath, fs.constants.COPYFILE_EXCL, (err) => {
                if (err) {
                  return callback(err);
                }

                winston.info('Copied file to target directory', {
                  localPath: localPath,
                  tmpPath: tmpPath
                });

                callback();
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
                var included = filter(_.get(pathConfig, 'filter'), documents);

                winston.info(`Found ${included.length} document(s) to download`, {
                  documentCount: included.length,
                  remote: folder.getPath()
                });

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
            if (folderQueue.running() > 0 || folderQueue.length() > 0) {
              folderQueue.drain = callback;
            } else {
              callback();
            }
          },
          (callback) => {
            if (documentQueue.running() > 0 || documentQueue.length() > 0) {
              documentQueue.drain = callback;
            } else {
              callback();
            }
          }
        ], callback);
      }, callback);
    },
    (callback) => {
      /**
       * Delete temporary directory
       */

      winston.info('Deleting temp directory', {
        directory: tmpDir
      });

      rimraf(tmpDir, callback);
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
