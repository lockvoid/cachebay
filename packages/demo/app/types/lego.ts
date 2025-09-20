export interface ColorNode {
  id: string | number;
  name: string;
  rgb: string;
}

export interface SpellNode {
  id: string | number;
  name: string;
  slug: string;
  category: string;
  creator?: string;
  effect: string;
  image?: string;
  light?: string;
  wiki?: string;
}
