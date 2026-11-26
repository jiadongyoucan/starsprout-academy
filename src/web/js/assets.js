const SPECIES = {
  bunny: { body: '#FFF7EC', shade: '#F1DFC4', inner: '#FBCFE8', accent: '#F9A8D4', label: '团子兔', tagline: '软软的、爱抱抱' },
  fox: { body: '#FDBA74', shade: '#F59E0B', inner: '#FED7AA', accent: '#FB923C', label: '小橘狐', tagline: '好奇心装满小口袋' },
  dragon: { body: '#A7F3D0', shade: '#6EE7B7', inner: '#FDE68A', accent: '#34D399', label: '芽芽龙', tagline: '活力满满的小冒险家' },
};

export function speciesMeta(species) {
  return SPECIES[species] || SPECIES.bunny;
}

function eyes(mood) {
  const dark = '#3B2A1F';
  if (mood === 'sleepy') {
    return `<path d="M78 103 Q87 110 96 103" stroke="${dark}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M124 103 Q133 110 142 103" stroke="${dark}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }
  if (mood === 'sad') {
    return `<path d="M74 96 Q84 90 94 98" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M126 98 Q136 90 146 96" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="84" cy="106" r="7" fill="${dark}"/><circle cx="136" cy="106" r="7" fill="${dark}"/>
      <circle cx="86" cy="103" r="2.4" fill="#fff"/><circle cx="138" cy="103" r="2.4" fill="#fff"/>
      <path d="M152 116 q-4 12 4 16 q7 -4 2 -16" fill="#7DD3FC" opacity=".9"/>`;
  }
  if (mood === 'excited') {
    return `<path d="M84 90 L88 101 L99 101 L90 108 L94 119 L84 112 L74 119 L78 108 L69 101 L80 101 Z" fill="#F59E0B"/>
      <path d="M136 90 L140 101 L151 101 L142 108 L146 119 L136 112 L126 119 L130 108 L121 101 L132 101 Z" fill="#F59E0B"/>`;
  }
  const big = mood === 'hungry';
  const r = big ? 8.5 : 7;
  return `<circle cx="84" cy="104" r="${r}" fill="${dark}"/><circle cx="136" cy="104" r="${r}" fill="${dark}"/>
    <circle cx="87" cy="${big ? 101 : 101}" r="2.6" fill="#fff"/><circle cx="139" cy="101" r="2.6" fill="#fff"/>`;
}

function mouth(mood) {
  if (mood === 'sad') return `<path d="M99 124 Q110 116 121 124" stroke="#3B2A1F" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  if (mood === 'hungry') return `<ellipse cx="110" cy="123" rx="9" ry="11" fill="#7C2D12"/><ellipse cx="110" cy="127" rx="5" ry="5" fill="#FB7185"/>`;
  if (mood === 'sleepy') return `<path d="M104 122 Q110 126 116 122" stroke="#3B2A1F" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  if (mood === 'excited') return `<path d="M96 118 Q110 138 124 118 Z" fill="#7C2D12"/><path d="M103 128 Q110 134 117 128" fill="#FB7185"/>`;
  return `<path d="M100 120 Q110 130 120 120" stroke="#3B2A1F" stroke-width="4" fill="none" stroke-linecap="round"/>`;
}

function extras(mood) {
  if (mood === 'sleepy') return `<text x="158" y="74" font-size="20" fill="#6366F1" font-weight="700">z</text><text x="170" y="58" font-size="14" fill="#818CF8" font-weight="700">z</text>`;
  if (mood === 'excited') return `<path d="M40 70 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3Z" fill="#FDE68A"/><path d="M172 100 l2 7 7 2 -7 2 -2 7 -2 -7 -7 -2 7 -2Z" fill="#FBCFE8"/>`;
  if (mood === 'sad') return `<text x="152" y="150" font-size="16">💧</text>`;
  if (mood === 'hungry') return `<text x="150" y="152" font-size="18">🥕</text>`;
  return `<path d="M166 132 c-5 -8 6 -14 8 -5 c2 -9 13 -3 7 5 l-7 8Z" fill="#F9A8D4" opacity=".85"/>`;
}

export function petSvg(species, mood = 'happy', equipped = [], size = 170, className = '') {
  const p = speciesMeta(species);
  const has = (code) => Array.isArray(equipped) && equipped.includes(code);
  const behind = has('star-cape')
    ? `<path d="M62 128 Q110 112 158 128 L174 194 Q110 214 46 194Z" fill="#6366F1" opacity=".9"/><path d="M110 130 l5 10 11 1 -8 8 2 11 -10 -5 -10 5 2 -11 -8 -8 11 -1Z" fill="#FDE68A"/>`
    : '';
  const front = `
    ${has('flower-scarf') ? `<path d="M74 136 Q110 154 146 136 L150 150 Q110 170 70 150Z" fill="#FB7185"/><circle cx="146" cy="154" r="8" fill="#FB7185"/>` : ''}
    ${has('round-glasses') ? `<circle cx="84" cy="104" r="15" fill="none" stroke="#4338CA" stroke-width="3" opacity=".9"/><circle cx="136" cy="104" r="15" fill="none" stroke="#4338CA" stroke-width="3" opacity=".9"/><path d="M99 102 h22" stroke="#4338CA" stroke-width="3"/>` : ''}
    ${has('yellow-hat') ? `<path d="M56 72 Q110 24 164 72 L164 82 Q110 66 56 82Z" fill="#FBBF24"/><path d="M50 82 Q110 62 170 82 Q172 92 166 94 Q110 78 54 94 Q48 92 50 82Z" fill="#F59E0B"/>` : ''}
    ${has('crown') ? `<path d="M64 62 L78 32 L94 54 L110 24 L126 54 L142 32 L156 62Z" fill="#FCD34D" stroke="#D97706" stroke-width="2"/><circle cx="110" cy="44" r="4" fill="#F472B6"/>` : ''}`;

  return `<svg class="pet-svg ${className}" width="${size}" height="${size}" viewBox="0 0 220 220" role="img" aria-label="${p.label}，${mood}">
    <ellipse cx="110" cy="198" rx="62" ry="12" fill="#3F3A2F" opacity=".10"/>
    ${behind}
    ${species === 'bunny' ? `<ellipse cx="82" cy="62" rx="16" ry="42" fill="${p.body}" stroke="${p.shade}" stroke-width="2" transform="rotate(-8 82 62)"/><ellipse cx="82" cy="64" rx="8" ry="30" fill="${p.inner}" transform="rotate(-8 82 64)"/>
      <ellipse cx="138" cy="62" rx="16" ry="42" fill="${p.body}" stroke="${p.shade}" stroke-width="2" transform="rotate(8 138 62)"/><ellipse cx="138" cy="64" rx="8" ry="30" fill="${p.inner}" transform="rotate(8 138 64)"/>` : ''}
    ${species === 'fox' ? `<path d="M64 84 L58 34 L96 62Z" fill="${p.body}" stroke="${p.shade}" stroke-width="2"/><path d="M70 72 L68 48 L88 64Z" fill="${p.inner}"/>
      <path d="M156 84 L162 34 L124 62Z" fill="${p.body}" stroke="${p.shade}" stroke-width="2"/><path d="M150 72 L152 48 L132 64Z" fill="${p.inner}"/>` : ''}
    ${species === 'dragon' ? `<path d="M74 64 Q62 32 82 34 Q90 40 86 60Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/><path d="M146 64 Q158 32 138 34 Q130 40 134 60Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/>
      <path d="M158 152 Q196 146 188 178 Q176 198 152 182" fill="${p.body}" stroke="${p.shade}" stroke-width="2"/><path d="M178 162 l8 12" stroke="${p.shade}" stroke-width="4" stroke-linecap="round"/>` : ''}
    <ellipse cx="110" cy="128" rx="58" ry="54" fill="${p.body}" stroke="${p.shade}" stroke-width="2.5"/>
    <ellipse cx="110" cy="144" rx="32" ry="26" fill="${p.belly || '#FFFDF6'}" opacity=".9"/>
    <ellipse cx="82" cy="124" rx="10" ry="6" fill="#FB7185" opacity=".28"/>
    <ellipse cx="138" cy="124" rx="10" ry="6" fill="#FB7185" opacity=".28"/>
    ${eyes(mood)}
    ${mouth(mood)}
    ${species === 'fox' ? `<ellipse cx="110" cy="116" rx="20" ry="14" fill="#FFF7ED"/><circle cx="110" cy="110" r="4" fill="#3B2A1F"/>` : ''}
    <circle cx="110" cy="104" r="2.5" fill="#3B2A1F" opacity=".35"/>
    ${front}
    ${extras(mood)}
  </svg>`;
}

export function petLabel(species) {
  return speciesMeta(species).label;
}

export function moodLine(mood, name = '伙伴') {
  const lines = {
    happy: [`${name}今天心情很好，想和你一起学习`, `看到你回来，${name}的耳朵都竖起来了`],
    excited: [`${name}开心得转圈圈！`, `今天也要一起收集小星星呀`],
    hungry: [`${name}的肚子咕咕叫了，喂它一点好吃的吧`, '吃饱了才有力气一起玩'],
    sleepy: [`${name}打了个小哈欠，想睡觉了`, '学完这一小节，就陪它休息吧'],
    sad: [`${name}有点想你，抱抱它吧`, '没关系，慢慢来，我在这里陪你'],
  };
  const list = lines[mood] || lines.happy;
  return list[Math.floor(Math.random() * list.length)];
}
