# 'no-name' WebGPU Engine

A modern 3D game engine built from scratch using TypeScript and the WebGPU API. This project serves as a learning platform for advanced graphics programming concepts.

**I'll find a name for it.**

[engine_demo_30-09-2025.webm](https://github.com/user-attachments/assets/f4ae8923-2c84-4abb-b5e9-d7e1fd0db251)

## Features (As of 03/10/2025)

### Core Architecture

- **Three-Threaded Design:** Work is split across three threads:
  - **Main Thread:** Handles user input, the editor UI (ImGui) and the HUD metrics.
  - **Render Thread (Worker):** Manages the scene graph (ECS), runs all systems, and submits rendering commands to the GPU.
  - **Physics Thread (Worker):** Runs the Rapier3D physics simulation at a fixed timestep, decoupled from the render framerate.
- **Lock-Free State Synchronization:** Utilizes `SharedArrayBuffer` for high-frequency, zero-copy state sharing between threads for:
  - Real-time user input (keyboard/mouse).
  - Physics state snapshots (positions/rotations).
  - Live editor tweaks (lighting, fog, shadows).
- **Event-Driven Communication:** Uses `postMessage` for one-off commands and events, such as initialization, resizing, and asset loading triggers.
- **Entity-Component-System (ECS):** Data-oriented design (`src/core/ecs`) for flexibility.

### Rendering & Graphics

- **Physically-Based Rendering (PBR):** Implements a metallic/roughness PBR workflow for realistic materials with a rich feature set:
  - Core metallic/roughness properties.
  - Support for `KHR_materials_specular` extension for realistic dielectrics.
  - Material-level UV tiling and scaling.
- **Lighting & Shadows:**
  - **Clustered Forward Lighting:** It can handle a large number of dynamic point lights per frame.
  - **Image-Based Lighting (IBL):** A complete IBL pipeline for realistic ambient lighting, including diffuse irradiance mapping, pre-filtered specular environment maps, and a pre-computed BRDF lookup table.
  - **Dynamic Shadows:** Real-time cascaded shadow mapping (CSM) from a primary directional light (sun).
- **Atmospherics:**
  - **Skybox Rendering:** Renders HDR environment maps as dynamic backgrounds.
  - **Volumetric Fog:** Height-based exponential fog with sun in-scattering for atmospheric depth (needs work).

### Asset Pipeline

- **Advanced glTF 2.0 Loading:** Supports loading complex scenes with a focus on material, animation, and performance fidelity.
  - Scene hierarchy, transforms, and meshes.
  - PBR materials, including textures and animated properties via `KHR_animation_pointer`.
  - Full parsing of sampler properties (wrapping, filtering).
  - Support for extensions: `KHR_materials_emissive_strength`, `KHR_materials_unlit`, `KHR_materials_specular`, and `KHR_texture_basisu`.
- **Optimized Asset Formats:**
  - **Mesh Compression:** Decodes meshes compressed with `EXT_meshopt_compression` for smaller file sizes and faster loading.
  - **Texture Compression:** Supports Basis Universal (`.ktx2`) textures, transcoding them on the fly to the most optimal GPU format available (BCn, ETC, ASTC).
- **Tangent Generation:** Automatically generates MikkTSpace tangents for all loaded meshes to ensure consistent normal mapping.

## Getting Started

### Prerequisites (dev)

- Node.js and npm
- A modern web browser with WebGPU support (see compatibility guide below)

### Installation & Running

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd webgpu-test
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

### Controls

- Press `C` to toggle free camera mode.
- WASD/ZQSD for movement. `Space` for up, `Shift` for down.

### Other Commands

- **Build for production:** `npm run build`
- **Run linter:** `npm run lint`

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

# WebGPU Engine - Compatibility Guide

- Check the [Official WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

- On **Windows** and **macOS 26** :
  It should work on any recent Blink-based browser (Chrome, Edge, Brave etc) and Firefox.

- On **GNU/Linux** things get more _experimental_ :

Tested working: Firefox Nightly + Wayland + ( Nvidia | Intel )
Tested not working: Firefox (not supported), Blink-based browsers + Wayland + Nvidia (falls back to CPU renderer)

# Known bugs

- Resizing the canvas on Firefox based browsers _may_ induce severe slowdown/crash.
