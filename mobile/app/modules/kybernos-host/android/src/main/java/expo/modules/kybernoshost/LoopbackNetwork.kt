package expo.modules.kybernoshost

import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.net.Proxy

/** The only server the app's JavaScript talks to is its own engine on 127.0.0.1. A phone with a system proxy (a device cloud's, a company's) would send those requests to the proxy, which
 *  cannot reach the phone's loopback and answers 503: the engine was up and the boot screen waited for ever (seen on a BrowserStack Pixel 9). React Native's HTTP client therefore never uses a proxy.
 *  It must be installed before Expo's fetch module builds its client, hence `Application.onCreate` (plugins/with-no-proxy-client.js). The WebView does not need it: Chromium bypasses proxies for
 *  loopback addresses. */
object LoopbackNetwork {
  fun install() {
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient {
        Log.i("KybernosHost", "HTTP client without proxy created")
        return OkHttpClientProvider.createClientBuilder().proxy(Proxy.NO_PROXY).build()
      }
    })
    Log.i("KybernosHost", "HTTP client factory installed")
  }
}
