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
        springCm.getDocuments(_.get(path, 'remote'), (err, documents) => {
          var included = filter(_.get(path, 'filter'), documents);

          winston.info('Found', included.length, 'document(s) to download');

          // For each file
          //  > Download to file named with SpringCM UID
          //  > Move to wastebin (delete by default)

          callback();
        });
      }, callback);
    }
  ], (err) => {
    if (err) {
      winston.error(err);
    }

    if (springCm) {
      winston.info('Disconnecting from SpringCM');

      springCm.close(callback);
    } else {
      callback();
    }
  });
};
