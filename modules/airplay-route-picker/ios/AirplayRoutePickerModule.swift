import ExpoModulesCore
import AVKit
import UIKit
import MediaPlayer

public class AirplayRoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AirplayRoutePicker")

    // Programmatically opens the iOS system audio route picker.
    // AVRoutePickerView must be on-screen with a real size — iOS will not
    // present the sheet from a hidden or off-screen source view.
    // The internal UIButton is created during layout, so we trigger it on the
    // next runloop cycle (after addSubview forces a layout pass).
    AsyncFunction("showRoutePicker") {
      DispatchQueue.main.async {
        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()

        guard let windowScene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
              let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first
        else { return }

        // Place at the bottom-center of the screen (near where the button lives in the UI).
        // Must be on-screen and at least 44×44 so UIKit can anchor the sheet presentation.
        let w: CGFloat = 44
        let h: CGFloat = 44
        let x = (window.bounds.width - w) / 2
        let y = window.bounds.height - 120   // near the audio player bar
        let picker = AVRoutePickerView(frame: CGRect(x: x, y: y, width: w, height: h))
        picker.alpha = 0.001               // invisible but NOT hidden
        picker.backgroundColor = .clear
        picker.prioritizesVideoDevices = false
        window.addSubview(picker)

        // AVRoutePickerView creates its internal UIButton during layout.
        // Dispatch to next cycle so the layout pass completes before we search.
        DispatchQueue.main.async {
          func findButton(in view: UIView) -> UIButton? {
            if let btn = view as? UIButton { return btn }
            for sub in view.subviews {
              if let found = findButton(in: sub) { return found }
            }
            return nil
          }

          if let button = findButton(in: picker) {
            button.sendActions(for: .touchUpInside)
          }

          // Keep picker alive until the sheet has presented, then remove it
          DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            picker.removeFromSuperview()
          }
        }
      }
    }

    View(AirplayRoutePickerView.self) {
      Prop("tintColor") { (view: AirplayRoutePickerView, color: UIColor?) in
        view.applyTintColor(color)
      }
      Prop("activeTintColor") { (view: AirplayRoutePickerView, color: UIColor?) in
        view.applyActiveTintColor(color)
      }
    }
  }
}

class AirplayRoutePickerView: ExpoView {
  private let routePickerView = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    routePickerView.translatesAutoresizingMaskIntoConstraints = false
    routePickerView.prioritizesVideoDevices = false
    addSubview(routePickerView)

    NSLayoutConstraint.activate([
      routePickerView.centerXAnchor.constraint(equalTo: centerXAnchor),
      routePickerView.centerYAnchor.constraint(equalTo: centerYAnchor),
      routePickerView.widthAnchor.constraint(equalTo: widthAnchor),
      routePickerView.heightAnchor.constraint(equalTo: heightAnchor),
    ])

    // Haptic on tap
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
    tap.cancelsTouchesInView = false
    addGestureRecognizer(tap)
  }

  @objc private func handleTap() {
    let g = UIImpactFeedbackGenerator(style: .medium)
    g.prepare()
    g.impactOccurred()
  }

  func applyTintColor(_ color: UIColor?) {
    routePickerView.tintColor = color ?? .white
  }

  func applyActiveTintColor(_ color: UIColor?) {
    routePickerView.activeTintColor = color ?? .systemBlue
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}
