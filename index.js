const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const rc = require('rc');
const async = require('async');
const winston = require('winston');
const { Validator } = require('jsonschema');
const task = require('./task');
const commander = require('commander');
const WinstonCloudWatch = require('winston-cloudwatch');

require('winston-daily-rotate-file');

commander
  .version('0.1.0', '-v, --version', 'Display the current software version')
  .option('-c, --config [path]', 'Specify a configuration file to load')
  .option('--validate', 'Validate the configuration file')
  .parse(process.argv);

var config;
var fileTransport, consoleTransport, cwlTransport;

function done(err) {
  /**
   * Log any error and exit.
   */

  var code = 0;

  if (err) {
    code = 1;
    winston.error(err.message, err);
  }

  async.parallel([
    (callback) => fileTransport.on('finished', callback),
    (callback) => consoleTransport.on('finished', callback),
    (callback) => {
      if (cwlTransport) {
        cwlTransport.kthxbye(callback);
      } else {
        callback();
      }
    }
  ], () => {
    process.exit(code);
  });
}

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
    fileTransport = new (winston.transports.DailyRotateFile)({
      level: 'info',
      format: winston.format.simple(),
      filename: path.join(__dirname, 'logs', 'log-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    });

    //
    consoleTransport = new (winston.transports.Console)({
      level: 'info',
      format: winston.format.simple()
    });

    var transports = [
      fileTransport,
      consoleTransport
    ];

    // Set up default logger with our transports
    winston.configure({
      level: 'info',
      transports: transports
    });

    // Set up unhandled exception logging to our local log files and console
    winston.exceptions.handle(transports);

    callback();
  },
  (callback) => {
    /**
     * If --validate option was passed, validate the provided config and
     * exit.
     */

    config = rc('caas');

    if (commander.validate) {
      var validator = new Validator();
      var schema = JSON.parse(fs.readFileSync('./schema.json'));
      var code = 0;

      var result = validator.validate(config, schema);

      if (!result) {
        winston.info('? Schema validator encountered an error');
      }

      if (result.errors.length === 0) {
        winston.info('✓ Schema validated');

        done();
      } else {
        code = 1;

        var err = new Error('✗ Schema not validated');

        err.errors = result.validationErrors.map((err) => err.stack);

        done(err);
      }
    } else {
      return callback();
    }
  },
  (callback) => {
    /**
     * If we're using a CloudWatch logging configuration, add that to our
     * winston transports.
     */

    var cw = _.get(config, 'import-springcm.logs.cloudwatch');

    if (!cw) {
      return callback();
    }

    // Set up logging to AWS CloudWatch Logs
    cwlTransport = new WinstonCloudWatch(_.merge(cw, {
      messageFormatter: (entry) => {
        return JSON.stringify(_.get(entry, 'meta'));
      }
    }));

   var transports = [
     consoleTransport,
     fileTransport,
     cwlTransport
   ];

    // Set up default logger with our transports
    winston.configure({
      level: 'info',
      transports: transports
    });

    // Set up unhandled exception logging to our local log files and console
    winston.exceptions.handle(transports);

    callback();
  },
  (callback) => {
    winston.info('========================================');
    winston.info('caas-import-springcm');
    winston.info('========================================');

    callback();
  },
  (callback) => {
    /**
     * Run each configured import-springcm task.
     */

    async.eachSeries(_.get(config, 'import-springcm.tasks'), task, (err) => {
      callback(err);
    });
  }
], done);
