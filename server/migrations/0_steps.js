// Import all migration steps in order
// Each migration file registers itself with Migrations.add()

import './1_create_indexes.js';
import './2_seed_storefronts.js';
import './3_create_cover_queue_indexes.js';
import './4_add_gamename_sort_index.js';
