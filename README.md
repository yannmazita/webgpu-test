# WebGPU Rendering Engine

A modern 3D rendering engine (and game engine) built from scratch using TypeScript and the WebGPU API. This project serves as a learning platform for advanced graphics programming concepts.

[engine_demo_30-09-2025.webm](https://github.com/user-attachments/assets/f4ae8923-2c84-4abb-b5e9-d7e1fd0db251)


## Features (As of 25/09/2025)

### Architecture

- **Three-Threaded Architecture:** The engine is designed to maximize performance by splitting work across three threads:
  - **Main Thread:** Handles user input and UI.
  - **Render Thread:** Manages the scene, runs the ECS, and submits all rendering commands.
  - **Physics Thread:** Runs the physics simulation at a fixed timestep, independent of the render framerate.
- **Hybrid Thread Communication:** The engine uses a combination of communication methods, choosing the best tool for each task:
  - **`SharedArrayBuffer`:** Used for high-frequency, low-latency state synchronization, such as real-time user input, physics state, and editor tweaks. This allows for zero-copy data exchange.
  - **`postMessage`:** Used for initialization, infrequent events (like resizing the canvas), and synchronizing the frame loop between the main and render threads.
- **Entity-Component-System (ECS):** Data-oriented design (`src/core/ecs`) for flexibility.

### Rendering & Graphics

- **Physically-Based Rendering (PBR):** Implements a metallic/roughness PBR workflow for realistic materials.
- **Image-Based Lighting (IBL):** Features a complete IBL pipeline for realistic ambient lighting, including diffuse irradiance mapping, pre-filtered specular environment maps, and a pre-computed BRDF lookup table.
- **Clustered Forward Lighting:** Can handle a large number of dynamic lights efficiently.
- **Dynamic Shadows:** Real-time cascaded shadow mapping (CSM) from a primary directional light source.
- **glTF 2.0 Loading:** Supports loading complex scenes, including animated models, from the glTF format.
- **Skybox / Environment Mapping:** Renders HDR environment maps as backgrounds and for image-based lighting.

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

