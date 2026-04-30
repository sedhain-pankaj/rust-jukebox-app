#!/bin/bash
# generate_music_folder.sh
# Creates a 'music' folder and the required subdirectories.

# --- Configuration ---
# Get the directory where this script is located
# This ensures the 'music' folder is created next to the script.
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")

# Define the target music directory
MUSIC_DIR="$SCRIPT_DIR/music"

# List of required categories
CATEGORIES=(
    "Fifty Sixty"
    "Seventy"
    "Eighty"
    "Ninety"
    "2000"
    "Latest Hits"
    "Country"
    "Karaoke"
    "Special Occasion"
    "Christmas Song"
)

# ---------------------------------------------------------------------

# 1. Check if the main 'music' directory exists
if [ -d "$MUSIC_DIR" ]; then
    echo "Music folder already exists at $MUSIC_DIR"
    exit 0
fi

echo "Music folder not found. Creating at $MUSIC_DIR..."

# 2. Create the main music directory
mkdir "$MUSIC_DIR"

# Check if the music folder creation was successful
if [ $? -ne 0 ]; then
    echo "ERROR: Could not create the 'music' directory. Check system permissions."
    exit 1
fi

echo "Music folder created successfully."

# 3. Loop through all categories and create the nested structure (Category/img)
for CATEGORY in "${CATEGORIES[@]}"; do
    # Use -p flag to ensure parent directories are created if they don't exist
    TARGET_DIR="$MUSIC_DIR/$CATEGORY/img"
    
    mkdir -p "$TARGET_DIR"
    
    if [ -d "$TARGET_DIR" ]; then
        echo "Created: $TARGET_DIR"
    else
        echo "Failed:  $TARGET_DIR"
    fi
done

echo ""
echo "--------------------------------"
echo "Done. All folders generated successfully."
