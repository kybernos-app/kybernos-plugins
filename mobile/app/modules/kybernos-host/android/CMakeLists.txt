# One small shared library: it links the fogtape libnode.so (staged into src/main/jniLibs/<abi>/) and starts `node::Start` on a thread with a large stack.
cmake_minimum_required(VERSION 3.22.1)
project(kybernos_node CXX)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libnode.so)

add_library(kybernos_node SHARED src/main/cpp/node_shim.cpp)
target_link_libraries(kybernos_node node log)
target_link_options(kybernos_node PRIVATE -Wl,-z,max-page-size=16384)
