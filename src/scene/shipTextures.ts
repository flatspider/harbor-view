import * as THREE from "three";
import type { ShipCategory } from "../types/ais";

export type ShipCategoryTextureMap = Record<ShipCategory, THREE.Texture>;

export const SHIP_CATEGORY_TEXTURE_PATHS: Record<ShipCategory, string> = {
  special: "/textures/ships/special.png",
  passenger: "/textures/ships/passenger.png",
  cargo: "/textures/ships/cargo.png",
  tanker: "/textures/ships/tanker.png",
  other: "/textures/ships/other.png",
};

function loadTexture(url: string, loader: THREE.TextureLoader): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      (error) => reject(error),
    );
  });
}

export async function loadShipCategoryTextures(): Promise<ShipCategoryTextureMap> {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(
    (Object.entries(SHIP_CATEGORY_TEXTURE_PATHS) as Array<[ShipCategory, string]>).map(
      async ([category, url]) => {
        const texture = await loadTexture(url, loader);
        return [category, texture] as const;
      },
    ),
  );
  return Object.fromEntries(entries) as ShipCategoryTextureMap;
}

