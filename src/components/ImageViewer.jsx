import React from 'react';
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Download from "yet-another-react-lightbox/plugins/download";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";

function ImageViewer({ url, name, onClose }) {
  return (
    <Lightbox
      open={true}
      close={onClose}
      slides={[{ src: url, alt: name }]}
      plugins={[Zoom, Download, Fullscreen]}
      animation={{ fade: 250 }}
      controller={{ closeOnBackdropClick: true }}
    />
  );
}

export default ImageViewer;
