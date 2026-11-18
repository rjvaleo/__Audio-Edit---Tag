cmake_minimum_required(VERSION 3.22)
project(EngineProbe VERSION 0.0.1 LANGUAGES C CXX)

# The phase 1 probe: the engine core played through JUCE on the real sound
# card, checked against an offline replay (Source/Main.cpp has the notes).
#   cmake -S . -B build -DJUCE_DIR=/path/to/JUCE -DCMAKE_BUILD_TYPE=Release

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

juce_add_console_app(probe PRODUCT_NAME "probe")
add_dependencies(probe engine_build)
target_sources(probe PRIVATE Source/Main.cpp)
target_compile_definitions(probe PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_STANDALONE_APPLICATION=1)
target_link_libraries(probe PRIVATE
  "${ENGINE_LIB}"
  juce::juce_audio_devices
  juce::juce_audio_basics
  juce::juce_events
  juce::juce_core
  juce::juce_recommended_config_flags)

# What a Rust static library needs from each system.
if(WIN32)
  target_link_libraries(probe PRIVATE ws2_32 userenv ntdll bcrypt)
elseif(UNIX AND NOT APPLE)
  target_link_libraries(probe PRIVATE pthread dl m)
endif()
