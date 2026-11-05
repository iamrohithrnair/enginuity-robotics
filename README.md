# Enginuity
<!-- Browser-based robot-cell engineering, simulation, and controller program export. -->

## From plain English to robot motion.

**An agentic robotics workspace that builds cells, tests motion in simulation, and exports controller-native programs—all from your browser.**

Physical AI needs more than a convincing answer. It needs a place to prove that an action can work before a machine moves.

## The problem: five million robots, one very human bottleneck

Factories installed **603,000 industrial robots in 2025**, a record. More than **5 million** are now operating worldwide, with another **655,000 installations forecast for 2026**. Every one needs programming—and reprogramming when production changes. [Source: IFR, World Robotics 2026](https://ifr.org/ifr-press-releases/news/five-million-robots-now-operate-in-factories-globally/).

On the shop floor, teaching a robot can mean stopping the line while a specialist defines movements point by point. Each manufacturer brings another language: ABB's RAPID, KUKA's KRL, and more.

Offline programming avoids tying up the physical robot, but expensive software is only the first hurdle. Someone must still construct the cell, check reach and collisions, and refine cycle times. For many smaller manufacturers, the engineering effort is the barrier.

AI can write code. **A factory needs evidence that the motion makes sense.** A plausible instruction is not enough when a wrong move can hit a fixture.

## The solution: give AI an engineering workspace

Describe a task: **“Build a pick-and-place cell for these parts, check the robot's reach, and generate an ABB program.”**

Enginuity connects that intent to an executable workflow:

1. **Understand:** interpret the task and use attached photos or sketches as context.
2. **Build:** create robots, tools, fixtures, targets, and programs in an interactive 3D cell.
3. **Test and refine:** use simulation, reachability and collision checks, and timing feedback to inspect and revise proposed motion.
4. **Export:** generate the controller's own language through **73 post processors**, including ABB, KUKA, FANUC, and Universal Robots.

The agent operates on the same station commands as the UI. It can act, inspect results, and revise the cell—not merely describe what an engineer should do.

**The output is an inspectable virtual cell and controller-native code, not just a chat response.** Simulation supports engineering review; physical deployment still requires commissioning.

## Meta is the perception and reasoning layer

| Meta product | Role in Enginuity |
| --- | --- |
| **Muse Spark 1.3 · Meta Model API** | Default tool-using agent: interprets goals, edits the station, invokes engineering tools, and reasons over their results. |
| **SAM 3.1 · Meta Model API** | Finds named objects in attached photos and returns image-space boxes that help ground the initial cell layout. |
| **Muse Spark 1.2 · Meta search grounding** | Retrieves cited information for engineering research, including robot specifications and task context. |
| **Muse Spark 1.2 · structured-output guardrails** | Classifies requests for scope and prompt-injection risks, alongside deterministic tool-permission checks. |
| **Muse Wonder** | Selectable alternative reasoning model for the Copilot. |

Photos provide context, not automatic metric calibration: dimensions and placement can be refined in the station before checking motion.

## Why this matters for physical AI

Most AI interfaces end with an answer. Enginuity connects an answer to **geometry, motion, feedback, and a controller program**.

Meta models handle intent, perception, and reasoning. The robotics engine supplies numerical checks; dedicated post processors handle controller syntax. That separation lets the agent learn from engineering feedback rather than treating its own confidence as validation.

This is the bridge from generative AI to programmable industry: **describe → build → simulate → inspect → refine → export**.

The ambition is to make robot programming accessible to manufacturers that cannot maintain a dedicated simulation team—and make changing a production task less dependent on scarce, vendor-specific expertise.

## Engineering underneath

- Browser-based 3D station with robot kinematics, motion simulation, collision checking, and optional physics.
- Rust/WebAssembly geometry kernels and a Python controller-code generation runtime.
- Next.js, React, Three.js, and React Three Fiber.
- **73 controller post processors**, with automated TypeScript, Python, and Rust verification.

## Run locally

```sh
npm ci
```

Set `MODEL_API_KEY` in your shell or an untracked `.env.local` to your Meta Model API key, then:

```sh
npm run dev
```

Model, grounding, guardrail, and photo settings are available under **Options → Copilot**.

For the Python program-generation environment:

```sh
npm run python:setup
```

## Verification

```sh
npm test
npm run test:py
npm run test:rust
npm run test:cad
```

See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
