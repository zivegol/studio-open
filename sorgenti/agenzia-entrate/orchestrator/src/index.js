'use strict';
const cfg = require('./config');
(cfg.role === 'worker' ? require('./worker') : require('./api')).start();
