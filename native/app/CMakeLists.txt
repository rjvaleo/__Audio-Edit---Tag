cmake_minimum_required(VERSION 3.22)
project(IdmLabApp VERSION 0.1.0 LANGUAGES C CXX)

# The native app (APP-PLAN.md): JUCE around the Rust engine, linked as one
# static library through its C interface (Source/na.h).
#   cmake -S . -B build -DJUCE_DIR=/path/to/JUCE -DCMAKE_BUILD_TYPE=Release
# On the iMac, tools/app-on-imac.sh does this gently.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(JUCE_DIR "" CACHE PATH "A JUCE checkout")
if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "Set -DJUCE_DIR to a JUCE checkout")
endif()
add_subdirectory("${JUCE_DIR}" juce EXCLUDE_FROM_ALL)

# The engine, built by cargo as a static library. Cargo decides what is stale.
set(RUST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(RUST_TARGET "${CMAKE_CURRENT_BINARY_DIR}/rust")
if(WIN32)
  set(ENGINE_LIB "${RUST_TARGET}/release/engine_capi.lib")
else()
  set(ENGINE_LIB "${RUST_TARGET}/release/libengine_capi.a")
endif()
add_custom_target(engine_build ALL
  COMMAND cargo build --release -p engine-capi --target-dir "${RUST_TARGET}"
  WORKING_DIRECTORY "${RUST_DIR}"
  BYPRODUCTS "${ENGINE_LIB}"
  VERBATIM)

juce_add_gui_app(idMLab
  PRODUCT_NAME "idMLab"
  COMPANY_NAME "idMLab"
  BUNDLE_ID "local.idmlab.native"
  VERSION 0.1.0)
add_dependencies(idMLab engine_build)
# Each page's look, captured from MGL's own page (tools/face-capture).
# Every theme and kit, captured from idMLab and MGL (tools/face-capture/capture-themes.mjs).
file(GLOB THEME_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/faces/themes/*")
file(GLOB ATMOS_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/faces/atmos/*.json.gz")
file(GLOB EDIT_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/faces/edit/*.json.gz" "${CMAKE_CURRENT_SOURCE_DIR}/faces/edit/edit-page.json")
juce_add_binary_data(idmlab_faces SOURCES faces/wave.json ${THEME_FILES} ${ATMOS_FILES} ${EDIT_FILES}
  ../engine-app/data/atmos-page.json
  faces/idmlab/idmlab-bar.json faces/idmlab/idmlab-status.json faces/idmlab/idmlab-node-audio.json
  faces/idmlab/idmlab-node-notes.json faces/idmlab/idmlab-menu.json faces/idmlab/idmlab-style.json)
target_sources(idMLab PRIVATE Source/Main.cpp Source/Host.cpp Source/Canvas.cpp Source/Face.cpp
  Source/Canvas2D.cpp Source/WaveDraw.cpp Source/WaveFace.cpp Source/AtmosFace.cpp
  Source/EditFace.cpp Source/SoundFace.cpp Source/EditBench.cpp)
target_compile_definitions(idMLab PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:idMLab,JUCE_PRODUCT_NAME>"
  JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:idMLab,JUCE_VERSION>")
target_link_libraries(idMLab PRIVATE
  "${ENGINE_LIB}"
  idmlab_faces
  juce::juce_audio_utils
  juce::juce_audio_devices
  juce::juce_gui_basics
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags)

if(WIN32)
  target_link_libraries(idMLab PRIVATE ws2_32 userenv ntdll bcrypt synchronization)
elseif(UNIX AND NOT APPLE)
  target_link_libraries(idMLab PRIVATE pthread dl m)
endif()
