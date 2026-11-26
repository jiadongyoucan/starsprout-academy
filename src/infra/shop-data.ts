export type ShopItemSeed = {
  code: string; kind: 'food' | 'clothing' | 'toy' | 'decor';
  name: string; emoji: string; price: number; description: string;
  effect: Record<string, number>; sort: number; available?: boolean;
};

/** 宠物小铺：食物、衣服、玩具、房间装饰。价格与效果由服务端权威计算。 */
export const SHOP_ITEMS: ShopItemSeed[] = [
  { code: 'carrot', kind: 'food', name: '脆脆胡萝卜', emoji: '🥕', price: 8, description: '团子最爱的脆脆胡萝卜，饱食度 +26', effect: { hunger: 26, happiness: 3, exp: 2 }, sort: 1 },
  { code: 'cookie', kind: 'food', name: '星星饼干', emoji: '🍪', price: 10, description: '烤成星星形状的小饼干，心情 +8', effect: { hunger: 18, happiness: 8, exp: 2 }, sort: 2 },
  { code: 'milk', kind: 'food', name: '云朵牛奶', emoji: '🥛', price: 12, description: '喝完睡得更香，精力 +10', effect: { hunger: 20, energy: 10, exp: 2 }, sort: 3 },
  { code: 'honey', kind: 'food', name: '蜂蜜小罐', emoji: '🍯', price: 16, description: '甜甜的奖励，饱食 +30、心情 +6', effect: { hunger: 30, happiness: 6, exp: 3 }, sort: 4 },
  { code: 'yellow-hat', kind: 'clothing', name: '小黄帽', emoji: '👒', price: 60, description: '春天的第一顶小帽子', effect: { happiness: 4 }, sort: 10 },
  { code: 'round-glasses', kind: 'clothing', name: '圆框眼镜', emoji: '👓', price: 80, description: '戴上就像一位小小学者', effect: { happiness: 5 }, sort: 11 },
  { code: 'flower-scarf', kind: 'clothing', name: '花花围巾', emoji: '🧣', price: 90, description: '软软的，挡住冬天的风', effect: { happiness: 6 }, sort: 12 },
  { code: 'crown', kind: 'clothing', name: '月桂小皇冠', emoji: '👑', price: 180, description: '给坚持学习的你', effect: { happiness: 10 }, sort: 14 },
  { code: 'yarn-ball', kind: 'toy', name: '毛线球', emoji: '🧶', price: 40, description: '滚来滚去的毛线球，心情 +6', effect: { happiness: 6 }, sort: 20 },
  { code: 'ball', kind: 'toy', name: '小皮球', emoji: '⚽', price: 30, description: '一起去院子里玩球吧', effect: { happiness: 5 }, sort: 21 },
  { code: 'bubble', kind: 'toy', name: '泡泡机', emoji: '🫧', price: 70, description: '满屋子都是彩虹泡泡', effect: { happiness: 8 }, sort: 22 },
  { code: 'lamp', kind: 'decor', name: '小夜灯', emoji: '💡', price: 100, description: '把房间照成暖暖的橙色', effect: { happiness: 5 }, sort: 30 },
  { code: 'moon-rug', kind: 'decor', name: '月亮地毯', emoji: '🌙', price: 150, description: '踩上去像踩在云朵上', effect: { happiness: 7 }, sort: 31 },
  { code: 'plant', kind: 'decor', name: '小盆栽', emoji: '🪴', price: 60, description: '和伙伴一起长大的绿芽', effect: { happiness: 4 }, sort: 32 },
  { code: 'star-cape', kind: 'clothing', name: '星星披风', emoji: '🦸', price: 0, description: '完成一份计划才能拥有的勇气披风', effect: { happiness: 8 }, sort: 13, available: false },
];
