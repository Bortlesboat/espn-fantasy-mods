/* declutter: hide the sticky "Fantasy Chat" bar. Toggle from the Tampermonkey menu. */
(function () {
  'use strict';
  const M = EspnMods;
  M.registerMod('declutter', 'Hide Fantasy Chat bar');
  if (!M.enabled('declutter')) return;
  M.css(`.bottomBarContainer{display:none !important}`);
})();
