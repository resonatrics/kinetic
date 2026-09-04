cmake_minimum_required(VERSION 3.22)

project(KINETIC VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(external/JUCE)

set(KINETIC_UI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui/dist")
set(KINETIC_UI_FILES
    "${KINETIC_UI_DIR}/index.html"
    "${KINETIC_UI_DIR}/index.js"
    "${KINETIC_UI_DIR}/styles.css")

foreach(asset IN LISTS KINETIC_UI_FILES)
    if(NOT EXISTS "${asset}")
        message(FATAL_ERROR "Missing ${asset}. Build the web UI first with: cd ui && pnpm install && pnpm build")
    endif()
endforeach()

juce_add_binary_data(KineticAssets
    HEADER_NAME KineticAssets.h
    NAMESPACE KineticAssets
    SOURCES ${KINETIC_UI_FILES})

set(KINETIC_NEEDS_WEBVIEW2 FALSE)

if(WIN32)
    include(FetchContent)

    set(KINETIC_WEBVIEW2_VERSION "1.0.3485.44")
    set(KINETIC_WEBVIEW2_SOURCE_DIR
        "${CMAKE_BINARY_DIR}/_deps/Microsoft.Web.WebView2.${KINETIC_WEBVIEW2_VERSION}")

    FetchContent_Declare(KineticWebView2
        URL "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${KINETIC_WEBVIEW2_VERSION}"
        SOURCE_DIR "${KINETIC_WEBVIEW2_SOURCE_DIR}"
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(KineticWebView2)

    set(JUCE_WEBVIEW2_PACKAGE_LOCATION "${CMAKE_BINARY_DIR}/_deps")
    set(KINETIC_NEEDS_WEBVIEW2 TRUE)
endif()

juce_add_plugin(Kinetic
    COMPANY_NAME "Resonatrics"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 ${KINETIC_NEEDS_WEBVIEW2}
    PLUGIN_MANUFACTURER_CODE Reso
    PLUGIN_CODE Kine
    FORMATS VST3 Standalone
    PRODUCT_NAME "Kinetic")

juce_generate_juce_header(Kinetic)

target_sources(Kinetic
    PRIVATE
        src/PluginEditor.h
        src/PluginEditor.cpp
        src/PluginProcessor.h
        src/PluginProcessor.cpp)

target_compile_definitions(Kinetic
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        $<$<PLATFORM_ID:Windows>:JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1>)

target_link_libraries(Kinetic
    PRIVATE
        KineticAssets
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
