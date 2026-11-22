'use strict';

const fs = require('fs');
const path = require('path');

function loadPlugins(directory = path.join(__dirname, 'plugins')) {
  const registry = new Map();
  if (!fs.existsSync(directory)) return registry;

  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()) {
    const pluginPath = path.join(directory, file);
    try {
      const plugin = require(pluginPath);
      if (!plugin || typeof plugin.run !== 'function' || !Array.isArray(plugin.commands)) {
        throw new Error('plugin must export commands[] and async run(context)');
      }
      for (const command of plugin.commands) {
        if (typeof command !== 'string' || !/^[a-z0-9-]+$/.test(command)) {
          throw new Error(`invalid command alias: ${command}`);
        }
        if (registry.has(command)) throw new Error(`duplicate command: ${command}`);
        registry.set(command, plugin);
      }
    } catch (error) {
      console.error(`Could not load plugin ${file}: ${error.message}`);
    }
  }
  return registry;
}

module.exports = { loadPlugins };
