"use client";

 
 
 

import { create } from "zustand";

export interface PickedFeature {
  object: string;
  kind: "curve" | "point";
   
  index: number;
   
  point?: number;
   
  at?: [number, number, number];
}

export type CurveTool =
  | null
   
  | { mode: "create"; modify?: boolean; object: string | null; points: number[][] }
   
  | { mode: "select"; project: string; kind: "curve" | "point"; object: string | null; curves: number[] }
   
  | { mode: "surface"; orient: "normal" | "constant"; rot: [number, number, number]; preview: boolean };

interface MachiningUi {
  tool: CurveTool;
  picked: PickedFeature | null;
   
  picker: null | { kind: "points" | "curve" | "nc" | "print3d"; object?: string | null; project?: string };
  report: null | { title: string; html: string };
}

export const useMachiningUi = create<MachiningUi>(() => ({ tool: null, picked: null, picker: null, report: null }));
