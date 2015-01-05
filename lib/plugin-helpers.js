
var symbols = require('symbolsjs');
var nodeHelpers = require('./node-helpers');
var async = require('async');
var printit = require('printit');
const LOGGER = printit({ prefix: 'Cozy Light' });

module.exports = function(cozyLight){

  var npmHelpers = cozyLight.npmHelpers;
  var configHelpers = cozyLight.configHelpers;
  var routes = cozyLight.routes;

  var loadedPlugins = {};
  var startedPlugins = {};

  var pluginHelpers = {

    loadedPlugins:loadedPlugins,
    startedPlugins:startedPlugins,

    loadPlugin: function (pluginName, program) {
      var config = configHelpers.getConfig();
      var pluginConfig = config.plugins[pluginName];
      if (pluginConfig.disabled !== true) {
        var pluginPath = configHelpers.modulePath(pluginConfig.name);
        try {
          var pluginModule = require(pluginPath);

          var options = {
            name: pluginModule.name,
            displayName: pluginConfig.displayName,
            version: pluginConfig.version,
            description: pluginConfig.description,
            configPath: configHelpers.getConfigPath(),
            /*eslint-disable */
            config_path: configHelpers.getConfigPath(), // for backward compatibility
            /*eslint-enable */
            home: configHelpers.getHomePath(),
            npmHelpers: npmHelpers,
            cozyLight: cozyLight,
            proxy: proxy
          };

          if (pluginModule.configure){
            pluginModule.configure(options, config, program);
          }

          loadedPlugins[pluginName] = pluginModule;

          return pluginModule;

        } catch (err) {
          LOGGER.error('Can\'t load ' + pluginName);
          LOGGER.raw(err.stack);
        }
      }
      return null;
    },
    unloadPlugin: function (pluginName) {
      if ( startedPlugins[pluginName] ) {
        throw 'Can not unload started plugins, stop it first !';
      }
      delete loadedPlugins[pluginName];
    },

    /**
     * Loads all plugins.
     *
     * @param program Program or Plain object.
     * @param callback Termination.
     */
    loadAll: function (program, callback) {
      var config = configHelpers.getConfig();
      var loadPlugin = function (pluginName, cb) {
        pluginHelpers.loadPlugin(pluginName, program, cb);
      };
      async.eachSeries(Object.keys(config.plugins || {}),
        loadPlugin,
        callback);
    },

    /**
     * Start given plugin (require it, run configuration and apply change to
     * cozy light server).
     * NB: Do not load given plugin if it is disabled.
     *
     * @param pluginName The plugin name to start.
     * @param program The commander program to bind.
     * @param applicationServer The application server to connect the plugin on.
     * @param callback Termination.
     */
    start: function (pluginName, program, applicationServer, callback) {
      var config = configHelpers.getConfig();
      if (config.plugins[pluginName] === undefined) {
        LOGGER.error('Plugin ' + pluginName + ' not installed !');
      } else {
        try {
          if (loadedPlugins[pluginName] === undefined) {
            pluginHelpers.loadPlugin(pluginName, program);
          }
          var plugin = loadedPlugins[pluginName];

          if (plugin !== null) {
            startedPlugins[plugin] = true;
            if (plugin.configureAppServer !== undefined) {
              LOGGER.info('Configuring plugin ' + pluginName + '...');
              var logResult = function () {
                LOGGER.info('Plugin ' + pluginName + ' configured.');
                callback();
              };
              return plugin.configureAppServer(applicationServer, config, routes,
                logResult);
            }
          }

        } catch(err) {
          LOGGER.raw(err);
          LOGGER.error('Plugin ' + pluginName + ' loading failed.');
          return callback(err);
        }
      }
      return callback();
    },

    /**
     * Stop given plugin (unload it form cache and run its exit handleR).
     *
     * @param pluginName The plugin name to start.
     * @param callback Termination.
     */
    stop: function (pluginName, callback) {
      var config = configHelpers.getConfig();
      if (config.plugins[pluginName] === undefined) {
        LOGGER.error('Plugin ' + pluginName + ' not installed!');
      } else if (loadedPlugins[pluginName] === undefined) {
        LOGGER.error('Plugin ' + pluginName + ' not started!');
      } else {
        var options = config.plugins[pluginName];
        delete loadedPlugins[pluginName];
        try {
          var plugin = loadedPlugins[pluginName];
          nodeHelpers.clearRequireCache(configHelpers.modulePath(options.name));
          if (plugin.onExit !== undefined) {
            plugin.onExit(options, config, function (err) {
              if (err) {
                LOGGER.raw(err);
                LOGGER.info('\t' + symbols.err + '\t' + pluginName + '');
              } else {
                LOGGER.info('\t' + symbols.ok + '\t' + pluginName + '');
              }
              delete startedPlugins[pluginName];
              callback(err);
            });
          } else {
            delete startedPlugins[pluginName];
            LOGGER.info('\t' + symbols.ok + '\t' + pluginName + '');
          }
        } catch(err) {
          LOGGER.raw(err);
          LOGGER.error('Plugin ' + pluginName + ' failed for termination.');
          return callback(err);
        }
      }
      return callback();
    },

    /**
     * Start all plugins.
     *
     * @param program Program or Plain object.
     * @param app Express app.
     * @param callback Termination.
     */
    startAll: function (program, app, callback) {
      var attachPlugin = function (pluginName, cb) {
        pluginHelpers.start(pluginName, program, app, cb);
      };
      async.eachSeries(Object.keys(loadedPlugins),
        attachPlugin,
        callback);
    },

    /**
     * Stop all plugins.
     *
     * @param callback Termination.
     */
    stopAll: function (callback) {
      var plugins = Object.keys(loadedPlugins || {});
      async.eachSeries(plugins, pluginHelpers.stop, callback);
    }
  };

  return pluginHelpers;
};