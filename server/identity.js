/**
 * identity.js — Server identity and version info.
 */

const fs = require('fs');
const path = require('path');

const identityPath = path.join(__dirname, '..', 'data', 'identity.json');
const pkgVersion = require('../package.json').version;

function getIdentity() {
  try {
    const data = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    return { name: data.name || 'default', version: pkgVersion };
  } catch {
    return { name: 'default', version: pkgVersion };
  }
}

function getName() {
  return getIdentity().name;
}

module.exports = { getIdentity, getName };
