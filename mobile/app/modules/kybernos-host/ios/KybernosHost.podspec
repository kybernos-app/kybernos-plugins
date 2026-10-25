# The native half of the Kybernos app: embeds Node (fogtape build, vendor/) and the runtime payload (payload/), both staged by scripts/stage-native.mjs and never committed.
Pod::Spec.new do |s|
  s.name           = 'KybernosHost'
  s.version        = '0.1.0'
  s.summary        = 'Runs the Kybernos engine inside the app'
  s.description    = 'Starts the embedded Node once per process, unpacks the payload, and reports progress, log and exit status to JavaScript.'
  s.author         = 'Kybernos'
  s.homepage       = 'https://kybernos.app'
  s.license        = { type: 'Apache-2.0' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files   = '*.swift'
  s.vendored_frameworks = 'vendor/NodeMobile.xcframework'
  s.resources      = ['payload/*']
end
