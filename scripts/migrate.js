'use strict';
const { migrate } = require('../src/db/schema');
migrate();
console.log('Biochar tracker schema is current.');
