const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const async = require('async');
const winston = require('winston');
const task = require('./task');
const commander  = require('commander');

require('winston-daily-rotate-file');

commander
  .version('0.1.0', '-v, --version', 'Display the current software version')
  .option('-c, --config [path]', 'Specify a configuration file to load')
  .parse(process.argv);

async.waterfall([
  (callback) => {
    /**
     * Configure the default Winston logger with any custom transports we
     * want to use. We have to use the default so that it can be easily
     * shared across different files.
     *
     * Also set up an unhandled exception logger, so that if the service
     * ever crashes, we have a log dump of the thrown exception to review.
     */

    // Daily rotating log files stored locally
    var fileTransport = new (winston.transports.DailyRotateFile)({
      filename: path.join(__dirname, 'logs', 'log-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    });

    //
    var consoleTransport = new (winston.transports.Console)();

    // Set up default logger with our transports
    winston.configure({
      level: 'info',
      transports: [
        consoleTransport,
        fileTransport
      ]
    });

    // Set up unhandled exception logging to our local log files and console
    winston.handleExceptions([ consoleTransport, fileTransport ]);

    winston.info('========================================');
    winston.info('caas-import-springcm');
    winston.info('========================================');

    callback();
  },
  (callback) => {
    /**
     * Load the .caasrc, which contains the configuration for the SpringCM
     * import service.
     */

    var config = '.caasrc';

    if (commander.config) {
      config = commander.config;
    }

    winston.info('Loading', config);

    // Read file, pass it on
    fs.readFile(path.join(__dirname, config), callback);
  },
  (data, callback) => {
    /**
     * Parse the JSON config into a usable object
     */

    callback(null, JSON.parse(data));
  },
  (config, callback) => {
    /**
     * Scan the configuration and do any additional setup or initialization.
     */

    winston.info('Loading import-springcm configuration');

    // We expect to find an import-springcm configuration in .caasrc
    if (!_.get(config, 'import-springcm')) {
      return callback(new Error('No import-springcm configuration found'));
    }

    callback(null, _.get(config, 'import-springcm.tasks'));
  },
  (tasks, callback) => {
    /**
     * Run each configured import-springcm task.
     */

    async.eachSeries(tasks, task, (err) => {
      callback(err);
    });
  }
], (err) => {
  /**
   * Log any error and exit.
   */

  var code = 0;

  if (err) {
    code = 1;
    winston.error(err);
  }

  process.exit(code);
});
