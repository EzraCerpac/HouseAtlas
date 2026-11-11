/** Example page entry. ./isolation is this chunk's only static import, so its
 * replacements are in place before any application module, including shared
 * chunks, is evaluated: ./app and everything it imports load afterwards. */
import './isolation';

void import('./app');
