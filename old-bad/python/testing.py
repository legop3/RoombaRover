from pycreate2 import Create2
import time

bot = Create2('/dev/ttyACM0')

bot.start()

bot.safe()

bot.dock()