 

import type { ExampleBuilder } from "./builder";
import type { ThumbnailView } from "./thumbnail";

export interface ExampleSpec {
  name: string;
  description: string;
   
  features: string[];
   
  mainProgram: string;
   
  view: ThumbnailView;
   
  ratio?: number;
   
  expectedStatus?: RegExp[];
  build(b: ExampleBuilder): Promise<void>;
}
