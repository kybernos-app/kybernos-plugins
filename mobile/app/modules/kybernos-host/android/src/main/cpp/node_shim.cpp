// Starts the embedded Node once per process, on its own thread with a 16 MB stack, the way the iOS host does. libnode.so exports only the C++ entry point node::Start.
#include <jni.h>
#include <pthread.h>
#include <fcntl.h>
#include <unistd.h>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <string>
#include <memory>
#include <vector>

namespace node { int Start(int argc, char* argv[]); }

namespace {
constexpr int kRunning = -1000;
std::atomic<bool> g_started{false};
std::atomic<int> g_exit{kRunning};

struct Launch { std::vector<std::string> args; };

void* run(void* p) {
  std::unique_ptr<Launch> launch(static_cast<Launch*>(p));
  // node::Start wants one contiguous argv buffer
  size_t total = 0;
  for (auto& a : launch->args) total += a.size() + 1;
  char* buffer = new char[total];
  std::vector<char*> argv;
  char* cursor = buffer;
  for (auto& a : launch->args) { memcpy(cursor, a.c_str(), a.size() + 1); argv.push_back(cursor); cursor += a.size() + 1; }
  argv.push_back(nullptr);
  g_exit = node::Start(static_cast<int>(launch->args.size()), argv.data());
  return nullptr;
}

std::string str(JNIEnv* env, jstring s) {
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string out(c);
  env->ReleaseStringUTFChars(s, c);
  return out;
}
}  // namespace

extern "C" JNIEXPORT jboolean JNICALL Java_expo_modules_kybernoshost_NodeNative_start(JNIEnv* env, jclass, jstring logPath, jstring cwd, jobjectArray environment, jobjectArray arguments) {
  bool expected = false;
  if (!g_started.compare_exchange_strong(expected, true)) return JNI_FALSE;
  // the engine's console becomes the log file: the app reads the sign-in address from it
  int fd = open(str(env, logPath).c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) { dup2(fd, STDOUT_FILENO); dup2(fd, STDERR_FILENO); close(fd); }
  for (jsize i = 0; i < env->GetArrayLength(environment); i++) {
    std::string kv = str(env, static_cast<jstring>(env->GetObjectArrayElement(environment, i)));
    size_t eq = kv.find('=');
    if (eq != std::string::npos) setenv(kv.substr(0, eq).c_str(), kv.substr(eq + 1).c_str(), 1);
  }
  if (chdir(str(env, cwd).c_str()) != 0) { /* the engine then runs from the process directory */ }
  auto* launch = new Launch();
  for (jsize i = 0; i < env->GetArrayLength(arguments); i++) launch->args.push_back(str(env, static_cast<jstring>(env->GetObjectArrayElement(arguments, i))));
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 16 * 1024 * 1024);
  pthread_t thread;
  int rc = pthread_create(&thread, &attr, run, launch);
  pthread_attr_destroy(&attr);
  if (rc != 0) { delete launch; g_exit = 1001; return JNI_FALSE; }
  pthread_detach(thread);
  return JNI_TRUE;
}

// The exit code of Node, or -1000 while it runs.
extern "C" JNIEXPORT jint JNICALL Java_expo_modules_kybernoshost_NodeNative_exitCode(JNIEnv*, jclass) { return g_exit.load(); }
