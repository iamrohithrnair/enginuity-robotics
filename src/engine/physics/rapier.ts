 
 
 
 

export type Rapier = typeof import("@dimforge/rapier3d-deterministic-compat");

let mod: Rapier | null = null;
let loading: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  if (mod) return Promise.resolve(mod);
  loading ??= import("@dimforge/rapier3d-deterministic-compat")
    .then(async (m) => {
      const R = ((m as unknown as { default?: Rapier }).default ?? m) as Rapier;
      await R.init();
      mod = R;
      return R;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

 
export const rapierLoaded = (): Rapier | null => mod;
