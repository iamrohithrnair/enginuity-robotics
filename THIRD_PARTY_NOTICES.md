# Third-party notices

Enginuity's own code is under the MIT License ([LICENSE](LICENSE)). This file lists the third-party code that Enginuity's own features ship or load at run time:

- the Rust crates compiled into its two WebAssembly modules (`public/wasm/rc_core.wasm` and `public/wasm/rc_cad.wasm`, built from `crates/`);
- the npm packages behind the MCP server, the script sandbox, the Copilot's model requests, the animated icons, the exported simulation player, the optional physics and the SimReady import (sharp and three.js's USD loaders);
- the Python packages Enginuity downloads into its own Python environment when a script needs them (numpy, scipy, svgwrite, svgpathtools, OpenCV);
- the 3D assets, models and web services Enginuity uses at run time without shipping them: NVIDIA SimReady Assets (downloaded on demand from Hugging Face) and Meta's models (Muse Spark, Muse Wonder, SAM 3.1 and Meta's search grounding, called through the Meta Model API).

The application framework packages in `package.json` (Next.js, React, three.js, React Three Fiber and drei, the OpenAI SDKs, zod, zustand) are installed from npm under their own licences and are not repeated here.

Licences:

- **Rust crates:** every crate below is used under the MIT license. Where a crate offers several licences, the MIT option is the one taken. Crates used only at build time (proc-macro2, quote, syn, unicode-ident, serde_derive, thiserror-impl) are not shipped.
- **npm packages:** MIT, except the Rapier physics package and sharp (Apache-2.0). sharp's prebuilt libvips binaries are LGPL-3.0-or-later (see its section).
- **Icon artwork:** Lucide (ISC); some of its icons derive from Feather (MIT).
- **Python packages** (downloaded at run time, not shipped): numpy and scipy BSD-3-Clause (their wheels bundle further libraries, listed in their section), svgwrite and svgpathtools MIT, OpenCV (opencv-python-headless) Apache-2.0 (its wheels bundle FFmpeg under the LGPL; see its section).
- **3D assets** (downloaded at run time, not shipped): NVIDIA SimReady Assets, CC BY 4.0.
- **Models and services** (used over their APIs, not shipped): Meta's Muse Spark, Muse Wonder and SAM 3.1 models and Meta's search grounding, served by the Meta Model API under Meta's terms.

The MIT, ISC and Apache-2.0 texts are reproduced below; the Python packages' licence files are installed with them. The npm and crate versions were checked against `package-lock.json`, `node_modules/*/package.json` and the crates' `Cargo.lock` files; the Python versions are pinned in `python/env/requirements.txt`. The 2026-10-30 additions (sharp, the three.js USD loaders, SimReady) were checked on 2026-10-30 against `node_modules` and the Hugging Face dataset; the Meta Model API entries were checked on 2026-11-04 against Meta's developer documentation (https://dev.meta.ai/docs).

## npm packages used by the MCP server

| Package | Version | License | Source |
|---|---|---|---|
| @modelcontextprotocol/sdk | 1.32.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk (Copyright (c) 2024 Anthropic, PBC) |

Used by `src/server/mcp/**`, the `/api/mcp` route and `scripts/enginuity-mcp.mjs`. Its own dependencies are
installed from npm under their licenses (see `node_modules/<package>/LICENSE`).

## npm packages used by Enginuity scripts (the script sandbox)

| Package | Version | License | Source |
|---|---|---|---|
| quickjs-emscripten-core | 0.32.0 | MIT | https://github.com/justjake/quickjs-emscripten (Copyright (c) 2019-2024 Jake Teton-Landis) |
| @jitl/quickjs-singlefile-cjs-release-asyncify | 0.32.0 | MIT | https://github.com/justjake/quickjs-emscripten (Copyright (c) 2019-2024 Jake Teton-Landis); contains the QuickJS JavaScript engine compiled to WebAssembly, MIT, Copyright (c) 2017-2021 Fabrice Bellard and Charlie Gordon (https://bellard.org/quickjs/) |
| @jitl/quickjs-ffi-types | 0.32.0 | MIT | https://github.com/justjake/quickjs-emscripten (Copyright (c) 2019-2024 Jake Teton-Landis); installed as a dependency of quickjs-emscripten-core |

Used by `src/server/scripts/**` to run Enginuity scripts in a separate WebAssembly instance per run. The
robolink-style script API and robomath that run inside it (`src/server/scripts/prelude.ts`) are Enginuity's own code.

## npm packages used by the Copilot

| Package | Version | License | Source |
|---|---|---|---|
| undici | 7.30.0 | MIT | https://github.com/nodejs/undici (Copyright (c) Matteo Collina and Undici contributors) |

Used by `src/server/agent.ts` for model requests, so that a slow local model is not cut off while it reads the prompt.

## Icons (src/components/icons.tsx, src/components/icons/**)

| Package or source | Version | License | Source |
|---|---|---|---|
| @animateicons/react | 0.12.0 | MIT | https://animateicons.in, https://github.com/Avijit07x/animateicons (Copyright (c) 2025 Avijit Dey); bundles the motion animation runtime |
| lucide-animated: `cctv`, `hand-grab` and `map-pin-plus`, copied into `src/components/icons/animated/` | commit 4662fff | MIT | https://lucide-animated.com, https://github.com/pqoqubbw/icons (Copyright (c) 2024-2026 pqoqubbw); license text in `src/components/icons/animated/LICENSE` |
| motion (used by the lucide-animated copies) | 13.5.1 | MIT | https://github.com/motiondivision/motion (Copyright (c) 2024 Motion B.V.); installs framer-motion 13.5.1 (Copyright (c) 2018 Framer B.V.), motion-dom 13.5.1 and motion-utils 13.5.0 (Copyright (c) 2024 Motion B.V.), all MIT |
| Lucide icon artwork, drawn by both icon libraries above and stored as resting SVG markup in `src/components/icons/markup.generated.ts` | | ISC | https://lucide.dev, https://github.com/lucide-icons/lucide (Copyright (c) 2026 Lucide Icons and Contributors) |

Some Lucide icons are derived from Feather (https://github.com/feathericons/feather, MIT, Copyright (c) 2013-present
Cole Bemis); Lucide lists them in its license file. Of the icons used here, those are check, chevron-down, chevron-right,
command, corner-down-right, download, info, minus, move, plus, search, target, trash-2, x and zoom-in. The robot-specific
glyphs in `src/components/icons.tsx` (robot arm, reference frame, gripper tool, joint target, MoveJ/MoveL/MoveC,
rounding, station, grid, close-up, no-selection cursor, perspective) are Enginuity's own.

The MIT license text is at the end of this file. Lucide's license:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## public/wasm/rc_cad.wasm (crates/rc_cad: STEP / IGES import)

| Crate | Version | License | Source |
|---|---|---|---|
| cdt | 0.1.0 | MIT OR Apache-2.0 | https://github.com/Formlabs/foxtrot (Copyright (c) 2021 Formlabs) |
| geometry-predicates | 0.3.0 | MIT | https://github.com/elrnv/geometry-predicates-rs (Copyright (c) Egor Larionov; a port of Jonathan Richard Shewchuk's public-domain robust predicates) |
| thiserror | 1.0.69 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror (Copyright (c) David Tolnay) |

The STEP (ISO 10303-21) and IGES readers, the NURBS evaluation and the face tessellation in `crates/rc_cad` are Enginuity's own code.

## public/wasm/rc_core.wasm (crates/rc_core: kinematics, robot and station files)

| Crate | Version | License | Source |
|---|---|---|---|
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | https://github.com/oyvindln/adler2 |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| itoa | 1.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| zmij | 1.0.23 | MIT | https://github.com/dtolnay/zmij |

## npm package copied into exported simulations (public/sim-viewer/sim-viewer.js)

| Package | Version | License | Source |
|---|---|---|---|
| three (three.js) | 0.186.1 | MIT | https://threejs.org, https://github.com/mrdoob/three.js (Copyright 2010-2026 Three.js Authors) |

Export Simulation (Ctrl+E) and Make a Demo Station write an HTML player that contains a bundled copy of three.js, so the
files Enginuity writes redistribute it (WP-A3). The bundle `public/sim-viewer/sim-viewer.js` is built from
`src/viewer/simViewer.ts` by `scripts/build-sim-viewer.mjs` and keeps three.js's `@license` header. The build uses
rolldown (1.2.14, MIT), a build-time tool that is installed with vitest and is not shipped.

## npm package used by the optional rigid-body physics (src/engine/physics)

| Package | Version | License | Source |
|---|---|---|---|
| @dimforge/rapier3d-deterministic-compat | 0.21.0 | Apache-2.0 | https://rapier.rs, https://github.com/dimforge/rapier.js (Copyright 2020 Dimforge EURL) |

The Rapier physics engine for JavaScript: Dimforge's Rust crates rapier3d and parry3d (Apache-2.0, Copyright Dimforge
EURL) and their dependencies compiled to WebAssembly and inlined in the package. Enginuity uses it on the server only and
loads it the first time physics is switched on. The package ships no NOTICE file. The Apache License 2.0 text is at the end
of this file (also in `node_modules/@dimforge/rapier3d-deterministic-compat/LICENSE`).

## npm package used for SimReady thumbnails and texture colours (sharp)

| Package | Version | License | Source |
|---|---|---|---|
| sharp | 0.35.5 | Apache-2.0 | https://sharp.pixelplumbing.com, https://github.com/lovell/sharp (Copyright 2013 Lovell Fuller and others) |
| @img/sharp-&lt;platform&gt; (for example @img/sharp-darwin-arm64) | 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp; sharp's native module for the platform, installed as an optional dependency |
| @img/sharp-libvips-&lt;platform&gt; (for example @img/sharp-libvips-darwin-arm64) | 1.3.4 | LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips, https://www.libvips.org; prebuilt libvips and the libraries it depends on |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour; installed as a dependency of sharp |

A direct dependency since 2026-10-30 (`package.json`), used on the server by `src/server/simready/` to resize SimReady
thumbnails to WebP and to read texture colours. The Apache License 2.0 text is at the end of this file (also in
`node_modules/sharp/LICENSE`).

The prebuilt libvips binaries are LGPL-3.0-or-later and bundle further libraries under their own licences (among them
LGPL-3.0 for glib, pango and librsvg, BSD for libwebp and aom, MIT, the zlib licence and MPL-1.1 for cairo);
`node_modules/@img/sharp-libvips-<platform>/README.md` lists each library with its licence. They are dynamically linked
libraries that npm installs from the npm registry on the user's machine as an optional dependency of sharp; Enginuity
neither ships nor modifies them, and they can be replaced with another build of libvips as sharp's documentation
describes.

## three.js USD loaders used by the SimReady import (src/server/simready)

| Package | Version | License | Source |
|---|---|---|---|
| three (three.js): the USD loaders in `examples/jsm/loaders/` (`USDLoader.js`, `USDZLoader.js` and `usd/USDAParser.js`, `usd/USDCParser.js`, `usd/USDComposer.js`), of which the SimReady import uses `usd/USDCParser.js` | 0.186.1 | MIT | https://threejs.org, https://github.com/mrdoob/three.js (Copyright 2010-2026 Three.js Authors) |

Part of the three package that Enginuity already installs (see the application framework packages above). Enginuity's
SimReady import uses three.js's USDC parser on the server to read the binary (crate) layers of SimReady assets
(`src/server/simready/usd-layer.ts`). The text (USDA) parser, the layer composition (root layer, payloads, references),
the unit and axis conversion and the meshing into station objects are Enginuity's own code (`src/server/simready/`).
The MIT license text is at the end of this file.

## NVIDIA SimReady Assets (3D assets downloaded at run time)

| Assets | License | Source |
|---|---|---|
| NVIDIA SimReady Assets (Hugging Face dataset `nvidia/simready-assets`; 2,677 OpenUSD assets; revision 4763fbfa, 2026-10-29, when checked) | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) | https://huggingface.co/datasets/nvidia/simready-assets (NVIDIA) |

Enginuity does not include or redistribute any SimReady asset: this repository contains none. When the user adds an asset
(SimReady tab, File ▸ Add SimReady Asset…, or the `simready.load` command), Enginuity downloads only that asset's files
from Hugging Face into the local cache (`data/simready`, or `ENGINUITY_SIMREADY_DIR`; gitignored), together with its
thumbnail, and converts it (layer composition, millimetres, Z up, material colours) into a station object.

Attribution: "NVIDIA SimReady Assets" by NVIDIA, licensed under CC BY 4.0. Stations, exports, screenshots and videos that
contain SimReady objects contain converted (modified) copies of the assets; when they are shared, CC BY 4.0 asks for this
attribution, a link to the licence and a note that the assets were converted.

## Models and web services used by the Copilot (not shipped)

These are not installed or redistributed: Enginuity calls them over the Meta Model API with the user's own key
(`MODEL_API_KEY`, or the key entered in Options ▸ Copilot or, on a hosted server, in the Copilot panel), and their use is
governed by Meta's terms for the Meta Model API.

| Model or service | Used for | License or terms | Source |
|---|---|---|---|
| Muse Spark 1.3 (`muse-spark-1.3`) | The Copilot's default model (agent loop, photo reading) | Meta Model API terms | https://dev.meta.ai/docs/models |
| Muse Spark 1.2 (`muse-spark-1.2`) | The guardrail classifier and the web-search grounding calls; also a selectable Copilot model | Meta Model API terms | https://dev.meta.ai/docs/models |
| Muse Spark 1.1 and 1.3 Contributor (`muse-spark-1.1`, `muse-spark-1.3-contributor`) | Selectable Copilot models (Contributor mode lets Meta use the content to train its models, at a lower price) | Meta Model API terms | https://dev.meta.ai/docs/models |
| Muse Wonder (`muse-wonder-1.0`) | A selectable Copilot model | Meta Model API terms | https://dev.meta.ai/docs/models |
| SAM 3.1 (`sam-3.1`) | The Copilot's `photo_findObjects` tool: boxes for named objects in an attached photo | Meta Model API terms (Enginuity calls the hosted model and never downloads the weights) | https://dev.meta.ai/docs/media-segmentation |
| Meta Model API | The inference API that serves these models (`https://api.meta.ai/v1`), including the built-in `web_search` tool behind the Copilot's `web_search` | Meta's terms for the Meta Model API | https://dev.meta.ai |

Enginuity never downloads model weights. Web results returned by Meta's search grounding are third-party content: the
chat shows each one with its source.

## Python packages installed at run time (Enginuity's Python environment)

Enginuity ships no Python package of others. When a Python script needs one of the modules below, Enginuity downloads
it from PyPI into its own Python environment (`<data>/python-env`, a venv; `npm run python:setup` creates it ahead of
time). The list is `python/env/allowlist.json`; `python/env/requirements.txt` pins each version and the sha256 hash of
every wheel, and pip installs nothing else (`--require-hashes --only-binary :all:`, so nothing is built from source).

| Package | Version (by Python version) | License | Source | Installed for |
|---|---|---|---|---|
| numpy | 2.0.2 (3.9), 2.2.6 (3.10), 2.4.6 (3.11), 2.5.3 (3.12 and newer) | BSD-3-Clause | https://numpy.org, https://pypi.org/project/numpy/ (Copyright (c) 2005-2024, NumPy Developers) | `import numpy`, and as a dependency of scipy and svgpathtools |
| scipy | 1.13.1 (3.9), 1.15.3 (3.10), 1.17.1 (3.11), 1.18.1 (3.12 and newer) | BSD-3-Clause | https://scipy.org, https://pypi.org/project/scipy/ (Copyright (c) 2001-2002 Enthought, Inc., 2003-2024, SciPy Developers) | `import scipy`, and as a dependency of svgpathtools |
| svgwrite | 1.4.3 | MIT | https://github.com/mozman/svgwrite (Copyright (c) 2012, Manfred Moitzi) | `import svgwrite`, and as a dependency of svgpathtools |
| svgpathtools | 1.8.0 | MIT | https://github.com/mathandy/svgpathtools (Copyright (c) 2015 Andrew Allan Port) | `import svgpathtools` |
| opencv-python-headless | 4.14.0.94 | Apache-2.0 | https://github.com/opencv/opencv-python, https://opencv.org (Copyright (C) 2000-2022, Intel Corporation and others; OpenCV contributors) | `import cv2` |

The OpenCV wheels bundle further libraries, among them FFmpeg (LGPL-2.1 or later) for video input and output, which
the user approved. They are dynamically linked libraries inside the wheel that pip installs from PyPI on
the user's machine; Enginuity neither ships nor modifies them. The wheel lists them in
`<data>/python-env/lib/python3.X/site-packages/opencv_python_headless-<version>.dist-info/` and in OpenCV's
`LICENSE-3RD-PARTY.txt`.

The numpy and scipy wheels are binary builds. Besides their own BSD-3-Clause code they bundle OpenBLAS and LAPACK
(BSD-3-Clause) and, depending on the platform, the GCC runtime libraries (libgfortran, libgcc, libquadmath: GPL-3.0 with
the GCC Runtime Library Exception). Each wheel lists what it bundles in its licence file, installed as
`<data>/python-env/lib/python3.X/site-packages/<package>-<version>.dist-info/LICENSE.txt`.

## MIT license

Each MIT-licensed crate and package above carries this text under its own copyright line (see the sources above):

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Apache License 2.0

The Rapier package and sharp (with its @img/sharp-&lt;platform&gt; native modules) above are licensed under this text (their copyright lines: Copyright 2020 Dimforge EURL; Copyright 2013 Lovell Fuller and others):

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2020 Dimforge EURL

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
