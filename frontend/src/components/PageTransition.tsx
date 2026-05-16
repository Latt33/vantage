import { motion } from "framer-motion";
import { ReactNode } from "react";

/**
 * Hard horizontal scan-line wipe. Enter wipes left→right (180ms ease-out).
 * Exit wipes left→right out (120ms ease-in). Use inside <AnimatePresence mode="wait">.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      style={{ width: "100%", height: "100%" }}
      initial={{ clipPath: "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0% 0 0)" }}
      exit={{ clipPath: "inset(0 0 0 100%)" }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
