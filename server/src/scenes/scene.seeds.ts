/**
 * 场景种子数据（骨架部分，人工定义，不经过 LLM——见技术方案 6.4）。
 * LLM 只负责为叶子场景生成 vocabulary 与 expressions。
 * 二期扩展新场景：往这里加一条 + 跑一次 `npm run seed:scenes`，前端零改动。
 */
export interface SceneSeed {
  sceneKey: string;
  name: string;
  emoji: string;
  parent: string | null; // 父场景 sceneKey，顶级为 null（顶级仅作分组，不挂内容）
  aiPromptHint?: string; // 生成内容时的补充提示
}

export const SCENE_SEEDS: SceneSeed[] = [
  {
    sceneKey: 'home',
    name: '在家',
    emoji: '🏠',
    parent: null,
  },
  {
    sceneKey: 'home-kitchen',
    name: '厨房',
    emoji: '🍳',
    parent: 'home',
    aiPromptHint: '中国家庭常见物品，包含现代厨房电器（冰箱、微波炉、电饭煲等）与中式烹饪用具（砧板、炒锅、蒸锅等）',
  },
  {
    sceneKey: 'home-living',
    name: '客厅',
    emoji: '🛋️',
    parent: 'home',
    aiPromptHint: '中国家庭常见物品，包含大家电（电视、空调）、日常用品（遥控器、靠垫、茶几、插座等）',
  },
  {
    sceneKey: 'home-bedroom',
    name: '卧室',
    emoji: '🛏️',
    parent: 'home',
    aiPromptHint: '中国家庭常见物品，包含床上用品、家具（衣柜、床头柜）与小电器（闹钟、台灯、充电线等）',
  },
  {
    sceneKey: 'home-bathroom',
    name: '卫生间',
    emoji: '🚿',
    parent: 'home',
    aiPromptHint: '中国家庭常见物品，包含洗漱用品（牙刷、牙膏、毛巾）、卫浴设施（淋浴、洗手池、马桶）与小家电（吹风机等）',
  },
];

export function findSeed(sceneKey: string): SceneSeed | undefined {
  return SCENE_SEEDS.find((s) => s.sceneKey === sceneKey);
}

/** 叶子场景（实际承载内容的场景） */
export function leafSeeds(): SceneSeed[] {
  return SCENE_SEEDS.filter((s) => s.parent !== null);
}
