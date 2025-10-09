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

### Browser crashing bugs

- Resizing is extremely finicky and inefficient (destruction and creationg of several resources), the engine will start at canvas default 300x150, change tabs or resize _slightly_ or open the developper console to trigger a resize. Continously resizing (via window handles for example) _will_ crash the engine.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

# WebGPU Engine - Compatibility Guide

> Based on [Official WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
> Last Updated: September 2025

## Browser Implementation Status

### ✅ Shipped (Stable)

| Platform            | Browser     | Since Version | Status                  |
| ------------------- | ----------- | ------------- | ----------------------- |
| **Windows x86/x64** | Chrome/Edge | 113           | ✅ Fully shipped        |
| **Windows ARM64**   | Chrome/Edge | -             | 🚧 Behind flag¹         |
| **macOS**           | Chrome/Edge | 113           | ✅ Fully shipped        |
| **macOS**           | Safari      | Tahoe 26      | ✅ Fully shipped        |
| **Chrome OS**       | Chrome      | 113           | ✅ Fully shipped        |
| **Android**         | Chrome      | 121           | ✅ Fully shipped        |
| **iOS+**            | Safari      | 26            | ✅ Fully shipped        |
| **Windows**         | Firefox     | 141           | ✅ Shipped (2024-07-22) |

### 🚧 Experimental Support

| Platform      | Browser         | Status                | Notes                                  |
| ------------- | --------------- | --------------------- | -------------------------------------- |
| **GNU/Linux** | Chrome/Edge     | 🚧 Behind flag¹ ²     | Requires special launch flags          |
| **GNU/Linux** | Firefox Nightly | ✅ Enabled by default | **Recommended for GNU/Linux + NVIDIA** |
| **macOS**     | Firefox Nightly | ✅ Enabled by default | Coming to stable soon                  |
| **Android**   | Firefox         | 🚧 In development     | Not in Nightly yet                     |

¹ Requires `chrome://flags/#enable-unsafe-webgpu` flag
² GNU/Linux also requires command-line flags (see below)

## GNU/Linux Setup Instructions

### 🔧 Chrome/Chromium on GNU/Linux (Experimental)

According to the official WebGPU wiki, GNU/Linux support requires:

```bash
# Required launch flags for GNU/Linux
google-chrome --ozone-platform-hint=x11 \
              --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan
```

or

```bash
# Required launch flags for GNU/Linux
chromium --ozone-platform-hint=x11 \
              --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan
```

⚠️ **Important**:

- First enable `chrome://flags/#enable-unsafe-webgpu`
- Ensure graphics drivers are up-to-date

### 🦊 Firefox Nightly on GNU/Linux (Recommended)

```bash
# WebGPU is enabled by default in Nightly on GNU/Linux!
firefox-nightly
```

No configuration needed - works out of the box.

### Chrome GPU Status

```bash
# Check GPU acceleration status
google-chrome --ozone-platform-hint=x11 \
              --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan \
              chrome://gpu
```

## Platform-Specific Notes

### NVIDIA on Wayland

- The `--ozone-platform-hint=x11` flag is **required**
- Forces X11 backend to avoid Wayland GPU issues
- Proprietary drivers 535+ recommended

### AMD/Intel on GNU/Linux (not tested)

- Generally works well with Mesa 23.0+
- May work without `--ozone-platform-hint=x11` on some systems
- Update Mesa: `sudo apt install mesa-vulkan-drivers`

### WSL2 (not tested)

- WebGPU falls back to SwiftShader (software rendering)
- Not recommended for development
- Use native GNU/Linux or dual-boot instead

## Development Recommendations

1.  **GNU/Linux + NVIDIA Development**: Use **Firefox Nightly** - no configuration needed
2.  **Cross-browser Testing**: Keep Chrome/Chromium
3.  **CI/CD**: Use Chrome with software rendering for tests
