/**
 * Main index file that combines all widget modules
 * This maintains a single-file output while keeping source code modular
 */
import { bootstrap } from './bootstrap.js';
import { utils } from './utils.js';
import { session } from './session.js';
import { messageformatting } from './message-formatting.js';
import { cssgenerator } from './css-generator.js';
import { components } from './components.js';
import { controller } from './controller.js';
import { init } from './init.js';

/**
 * Combines all modules into a single embeddable script
 */
export const EMBED_SCRIPT = String.raw`
(function() {
  'use strict';

${bootstrap}

${utils}

${session}

${messageformatting}

${cssgenerator}

${components}

${controller}

${init}
})();
`.replaceAll(/\n\s+/g, '\n').trim();
