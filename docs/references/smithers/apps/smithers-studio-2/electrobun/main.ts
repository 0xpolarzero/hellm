import { installApplicationMenu } from "./applicationMenu";
import { createMainWindow } from "./createMainWindow";

// Bun main-process entrypoint for the Electrobun desktop shell. It installs the
// native menu and opens the window that loads the existing Vite app. The window
// reference is retained so it is not garbage collected for the process lifetime.
installApplicationMenu();

const mainWindow = createMainWindow();
void mainWindow;
