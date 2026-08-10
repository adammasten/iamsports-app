Pod::Spec.new do |s|
  s.name           = 'BackgroundUpload'
  s.version        = '1.0.0'
  s.summary        = 'Background URLSession uploader (local Expo module)'
  s.description    = 'Uploads a file to a presigned URL via an iOS background URLSession so transfers continue when the app is backgrounded or the screen is locked.'
  s.author         = ''
  s.homepage       = 'https://github.com/local/background-upload'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/local/background-upload.git', :tag => s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
