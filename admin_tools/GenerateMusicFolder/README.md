# 🎵 Music Folder Template Generator

This script provides a simple, cross-platform way to automatically set up the standard folder structure for a music project. When you run it, it creates a main `music` folder and populates it with 10 category folders, each containing an `img` subdirectory.

**Goal:** To create the necessary empty folder structure so you can begin organizing your music content and images.

## 📂 Files Provided

This folder contains two dedicated scripts, one for each major operating system:

- **`generate_music_folder(Windows).bat`**: The script designed to run on Windows PCs.
- **`generate_music_folders(Linux).sh`**: The script designed to run on Ubuntu/Linux systems.

---

## 🖥️ 🚀 How to Run on Windows

Windows is the easiest! The script is designed for a simple, one-click experience.

1.  **Double-Click:** Simply double-click the file named `generate_music_folder(Windows).bat`.
2.  **Wait:** A black command window (the terminal) will pop up, show you the folder creation process, and then close automatically when it is finished.

The complete folder structure will instantly appear in the same directory as the script.

---

## 🐧 🚀 How to Run on Ubuntu / Linux

Linux requires a few extra steps because you must explicitly give permission to the file before running it. Please follow these steps exactly.

### Step 1: Open the Terminal

- Open the **Terminal** application (usually accessible via a search or shortcut like `Ctrl + Alt + T`).

### Step 2: Navigate to the Folder

- In the Terminal, use the `cd` (change directory) command, followed by the path to the folder containing the script.
  _(Example: If your folder is on your Desktop, you would type: `cd ~/Desktop/MusicTemplate`)_

### ⚠️ Step 3: Grant Execution Permission (CRITICAL!)

- This command (`chmod`) tells the operating system that this file is allowed to be run as a program. **You must run this command once.**

  ```bash
  chmod +x generate_music_folders(Linux).sh
  ```

### Step 4: Run the Script

- You can now run the script by **double-clicking** the file in the file manager, **OR** you can run it directly in the Terminal:
  ```bash
  ./"generate_music_folders(Linux).sh"
  ```

The Terminal will display the progress, and the folder structure will be created right next to the script.

---
