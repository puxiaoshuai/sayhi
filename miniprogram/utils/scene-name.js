/** sceneKey → 中文名映射（用于收藏列表展示来源场景） */
const SCENE_NAMES = {
  home: '在家',
  'home-kitchen': '在家 · 厨房',
  'home-living': '在家 · 客厅',
  'home-bedroom': '在家 · 卧室',
  'home-bathroom': '在家 · 卫生间',
};

function sceneName(sceneKey) {
  return SCENE_NAMES[sceneKey] || sceneKey || '';
}

module.exports = { sceneName, SCENE_NAMES };
