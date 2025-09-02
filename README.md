# webgpu-test Learning graphics programming with WebGPU.

<img width="2550" height="1406" alt="1000 cubes with random transforms" src="https://github.com/user-attachments/assets/ebffe743-24a9-44aa-9db9-96699cdc3e1c" />

[engine-demo.mp4](https://github.com/user-attachments/assets/52bba8f5-a72e-453c-8bca-bdfe5bd06dc7)


# Setup

Simply install dependencies then run vite server:

`bash npm install npm run dev `

# WebGPU Engine - Compatibility Guide

> Based on [Official WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
> Last Updated: September 2025

## Browser Implementation Status

### ✅ Shipped (Stable)

| Platform            | Browser     | Since Version | Status                                                           |
| ------------------- | ----------- | ------------- | ---------------------------------------------------------------- |
| **Windows x86/x64** | Chrome/Edge | 113           | ✅ Fully shipped                                                 |
| **Windows ARM64**   | Chrome/Edge | -             | 🚧 Behind flag¹                                                  |
| **macOS**           | Chrome/Edge | 113           | ✅ Fully shipped                                                 |
| **macOS**           | Safari      | Tech Preview  | ✅ Enabled by default                                            |
| **Chrome OS**       | Chrome      | 113           | ✅ Fully shipped                                                 |
| **Android**         | Chrome      | 121           | ✅ Fully shipped                                                 |
| **iOS 18+**         | Safari      | 18            | ⚙️ Settings → Safari → Advanced → Experimental Features → WebGPU |
| **Windows**         | Firefox     | 141           | ✅ Shipped (2024-07-22)                                          |

### 🚧 Experimental Support

| Platform      | Browser         | Status                | Notes                         |
| ------------- | --------------- | --------------------- | ----------------------------- |
| **GNU/Linux** | Chrome/Edge     | 🚧 Behind flag¹ ²     | Requires special launch flags |
| **GNU/Linux** | Firefox Nightly | ✅ Enabled by default | **Recommended for GNU/Linux** |
| **macOS**     | Firefox Nightly | ✅ Enabled by default | Coming to stable soon         |
| **Android**   | Firefox         | 🚧 In development     | Not in Nightly yet            |

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

1. **GNU/Linux Primary Development**: Use **Firefox Nightly** - no configuration needed
2. **Cross-browser Testing**: Keep Chrome/Chromium
3. **CI/CD**: Use Chrome with software rendering for tests
