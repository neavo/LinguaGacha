---
name: unity
description: 翻译、审校、分析、修改 Unity 或 Naninovel 游戏前必须加载。
---

本技能提供 Unity 资源定位、解析与写回方法。导入和通用数据封装按 `project-operation` 和 `generic-data` 执行，翻译与审校按 `translation` 执行。

内置解析器不识别 Unity 游戏，资源中的文本都经通用数据进入工程。

# 识别

|特征|含义|
|---|---|
|根目录有 `UnityPlayer.dll` 和 `<游戏名>_Data/`|Unity 游戏|
|`<游戏名>_Data/Managed/Assembly-CSharp.dll`|Mono 构建，脚本类型来自 `Managed/` 下的程序集|
|根目录有 `GameAssembly.dll`，`<游戏名>_Data/il2cpp_data/Metadata/global-metadata.dat`|IL2CPP 构建，脚本类型来自这两个文件|

资源容器：

- `<游戏名>_Data/data.unity3d`：整体打包的主资源，内含 `globalgamemanagers`、`level*`、`sharedassets*.assets`、`resources.assets` 等文件。未打包的游戏直接把这些文件放在 `<游戏名>_Data/`。
- `<游戏名>_Data/StreamingAssets/aa/`：Addressables 资源包 `*.bundle` 与 `catalog.json` 或 `catalog.bin`。
- `.resS`、`.resource`：贴图和音频的流数据，不含文本。

# 文本来源

|来源|特征|处理|
|---|---|---|
|`MonoBehaviour` 序列化字段|对白表、本地化表、技能与物品数据等，通常是正文主体|按字段提取|
|`TextMeshProUGUI` 的 `m_text`|TextMeshPro 界面静态文字|运行时代码可能覆盖显示内容，抽样核对消费代码|
|`UnityEngine.UI.Text` 的 `m_Text`|旧版 UI 界面静态文字，字段名首字母大写|同上|
|`TextAsset` 的 `m_Script`|CSV、JSON 或自定义脚本，也可能是图片差分等二进制数据|按内容格式处理，零星源语言字符不能证明是正文|
|程序集硬编码字符串|Mono 在 `Assembly-CSharp.dll` 的 `#US` 字符串堆，IL2CPP 在 `global-metadata.dat`|按引用位置判断用途，见下文|
|贴图|图片中的文字|不处理|

本地化表常为每个键保存多种语言的值，语言编号不是跨游戏的标准。从实际记录确认源语言对应的编号，提取该语言的值并写回同一位置。

同名资源可能同时存在于主资源、`sharedassets` 和 Addressables 资源包中。沿实际加载链路确认生效的实例再提取。

字符串堆只保存字面量，不能说明哪些内容用于显示，含源语言文字的字面量也可能是日志或资源键。Mono 从方法体的 `ldstr` 指令找到每处引用，IL2CPP 在 `GameAssembly.dll` 中定位引用代码。记录程序集、类型、方法和指令位置，再按消费代码判断用途。同一字面量兼作键和显示文本时，按 `generic-data` 保留原值，在显示调用点处理。写回需要修改程序集或元数据，与资源中相同的文案是另一个写回位置，分别记录。

# 定位与解析

通过 `@lg/uv` 安装 `UnityPy` 读写资源，恢复脚本类型另需 `TypeTreeGeneratorAPI`。

## 读取入口

使用 [scripts/typetree.py](scripts/typetree.py) 读取 `MonoBehaviour`，统一修复生成节点并核对对象头部。读取沿用 UnityPy 默认路径，支持 C 扩展的环境使用 C 加速器。

从本技能 `read_skill` 返回的 `base_url` 复制脚本到任务 Python 脚本所在目录。包内写回程序依赖它时，一并放入 `.generic` 包，按 `generic-data` 保留依赖版本。

```js
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('work/py', { recursive: true });
await copyFile(new URL('scripts/typetree.py', base_url), 'work/py/typetree.py');
```

`read_monobehaviour` 优先读取资源自带的完整类型树。资源缺少类型树时，传入生成节点，函数先修复再读取。函数保留完整长度检查，并将脚本引用与独立解析的对象头部核对。返回值是 `(tree, nodes)`，写回复用返回的节点。资源自带类型树读取失败时保留错误，先调查失败原因。

## 对象定位

`path_id` 只在所属序列化文件内唯一。同一容器中的对象用 `(assets_file.name, path_id)` 定位，跨容器记录再带上容器路径。候选清单、对象索引和写回坐标沿用同一身份。只用 `path_id` 建索引会覆盖不同文件中的同号对象，随后用错误的类型树读取对象，表现为越界、负长度或字段错位。

`head = obj.parse_monobehaviour_head()` 返回 `MonoBehaviour` 对象，使用 `head.m_Script` 访问脚本引用。用 `head.m_Script.deref_parse_as_object()` 读取 `MonoScript`，从 `m_AssemblyName`、`m_Namespace` 和 `m_ClassName` 确定程序集和完整类名。引用未解析时，按 `m_FileID` 排查：`0` 指向当前文件，否则指向当前文件的 `externals[m_FileID - 1]`。加载缺失依赖后再解析。

## 类型检查与样本解析

1. 在对象原始数据 `get_raw_data()` 中搜索源语言文字的 UTF-8 字节，发现候选对象和类型。字节命中只提供线索，字段用途仍需结合结构和消费代码判断。
2. 资源缺少完整类型树时，使用 `from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator`，按 `assets_file.unity_version` 创建生成器。Mono 调用 `load_local_dll_folder`，IL2CPP 调用 `load_il2cpp`，或用 `load_local_game` 自动判断。用 `get_nodes_up(assembly, fullname)` 取得生成节点。同一 Unity 版本和程序集集合内，按 `(assembly, fullname)` 缓存节点。
3. 每种候选类型先用 `read_monobehaviour` 验证代表对象，涉及列表时包含非空列表样本。生成节点在读取前修复，读取未抛异常不能替代头部核对。含多态引用的生成节点会在读取前被拒绝，按类型记录对象并转入单独调查。
4. 探测前登记已尝试的类型与样本条件，成功和失败都记录结果。同一版本、程序集、类型和节点布局下的已知失败只汇总对象，解析方法或样本条件变化后再试。批量读取已验证类型时，每个对象仍须通过完整检查。

解析失败时，先核对对象身份、脚本引用和类型树。三者一致后，再逐字段记录读取位置，定位第一个读偏的字段。错误信息相同不代表原因相同。

### 生成类型树的已知缺陷

以下问题已在 UnityPy 1.25.4、`TypeTreeGeneratorAPI` 0.0.10 的样本上确认，其他版本或 IL2CPP 构建需先用样本核验。

- 列表类型名：生成 `List<string>` 等列表时，外层节点的类型名被写成元素类型，例如 `string`。UnityPy 按单个值读取该节点，后续数据全部错位。症状是同一个类的部分对象解析成功，其余对象报 `Negative length read from TypeTree`、`read_str out of bounds` 或读取长度不符。列表恰好为空的对象能够成功，因为空列表与空字符串的字节相同。
- 头部对齐：生成节点的根级 `m_Enabled` 缺少 4 字节对齐标记，读出的 `m_Script` 是错误值。按同一错误布局重新序列化仍可能得到相同字节，因此需要与 `parse_monobehaviour_head()` 的结果核对。
- 不参与序列化的字段：生成器会把 Unity 不序列化的字段加入类型树。已确认的是多维数组，例如 `Node[,] grid` 生成为单个 `Node grid` 节点，节点本身无法区分。症状是同类对象全部读取失败。从程序集字段签名确认字段不参与序列化后，将字段路径传给 `unserialized_fields`。按序列化规则判断，不按游戏类名维护特例，也不放宽完整长度检查。
- 多态引用：使用 `[SerializeReference]` 的样本含 `m_Type` 为 `managedReference` 或 `ManagedReferencesRegistry` 的节点，后者的 `m_Name` 可以是 `references`。当前生成节点无法正确读取这些样本，需单独调查类型信息和字段布局。

`read_monobehaviour` 内部调用 `repair_generated_tree(root, unserialized_fields)`，在独立节点中修复列表类型名和头部对齐，并删除调用者确认不参与序列化的字段。字段路径从根节点的子字段开始以 `.` 连接，例如 `settings.cells`，未命中时报错。资源自带类型树时不使用该参数。原节点保持原值，其他节点属性保留。发现多态引用时抛出 `NotImplementedError`。升级依赖或处理其他版本、构建方式时，先核验代表样本。

```python
from typetree import read_monobehaviour

generated = None
unserialized = ()  # 按程序集签名确认不参与序列化的字段路径，例如 ("grid",)。
if obj.serialized_type is None or obj.serialized_type.node is None:
    generated = generator.get_nodes_up(assembly, fullname)
tree, nodes = read_monobehaviour(obj, generated, unserialized)
# 修改已确认的显示字段后，读取和写回使用同一节点。
changed_bytes = obj.save_typetree(tree, nodes=nodes)
```

## 批量提取

确认可翻译类型与字段后，检查同类对象和字段的完整集合，每个待提取对象都需读取成功。字符扫描只用于发现入口，纯汉字、拉丁字母或符号组成的显示文本也可能需要处理。多语言表按已确认的语言编号选择记录。

按字段用途区分显示文本、资源键和开发备注。统计归组时保留字段名，只把数组下标归一化，避免把 `Text`、`Name` 和控制字段合并后丢失判断依据。候选对象按 `generic-data` 的全量清单归类，清单条目使用完整对象身份。未命中的类型给出排除依据，解析失败的对象记录容器、文件、`path_id`、类型和原因。

# 写回与验证

序列化字符串包含长度、UTF-8 正文和对齐填充。译文长度改变会移动后续数据，使用 `save_typetree` 按已验证的类型树重新序列化对象。

同一容器中的文本放在同一个通用数据包里共同写回，分开打包会相互覆盖。修改后保存整个容器。按 `generic-data` 的全量机械比较验证写回，保存后重新加载容器，逐项核对：

- 对象身份与类型树：用完整对象身份定位每个修改对象，以写回时的节点读回，通过完整长度与头部检查。核对目标字段、同一对象的其他字段和脚本引用。
- 未修改对象：容器内其余对象逐一比较原始字节或哈希。
- 容器与资源流：压缩方式、外部引用和 `.resS` 等资源流与原文件一致。

资源读回成功只证明结构有效，运行时加载与显示仍需按本次改动核验。

UnityPy 1.25.4 的 `Environment.save(pack="original", out_path=...)` 只保存标记为已修改的顶层文件，返回 `None`。`out_path` 目录需提前创建。对于单个资源包，可明确保存对应容器：

```python
from pathlib import Path

output_dir = Path("work/output")
output_dir.mkdir(parents=True, exist_ok=True)
# container 是 env.files 中与本次对象对应的顶层资源包。
output_file = output_dir / Path(container_path).name
output_file.write_bytes(container.save(packer="original"))
```

`save_typetree` 返回本次序列化的字节。当前版本的 `get_raw_data()` 仍读取原始 reader，刚写回后不能用它判断修改是否生效。保存后重新加载容器，通过 `read_monobehaviour` 核对字段和脚本引用。已有对象坐标和节点时，直接定位重读，避免为识别类型而遍历并解引用无关对象。确需解析外部引用时，加载相应依赖。

## Addressables 校验

修改 Addressables 资源包后，`catalog` 中记录的大小或 CRC 可能使游戏拒绝加载。写回资源包时检查 `catalog` 中对应条目，需要时同步更新。

# Naninovel

使用 Naninovel 框架的游戏，剧情在 `.nani` 脚本中，通常作为 `TextAsset` 或资源包内的文件保存：

- 命令名、参数名、角色 ID、插值和富文本外壳保持原样，只提取可见文本。例如姓名标签参数中的显示名可以翻译，角色 ID、玩家自定义姓名变量和存档键保持原值。
- 界面文字可能来自 Managed Text：带 `[ManagedText]` 特性的静态字段或 `ManagedTextProvider` 组件。资源已译但界面不变时，检查对应类型是否注册、资源是否加载，以及切换语言后界面是否重新读取。
- 静态构造函数可能在启动时把静态字段的原文复制进数组或字典，之后更新字段不会刷新这些缓存。这种情况需要改读取方法，或在字段更新后同步刷新缓存。

# 翻译

`m_text` 等 TextMeshPro 文本可能含富文本标签，例如 `<color=#FF0000>`、`<size=120%>`、`<sprite=0>`、`<br>`。标签名与参数保持原样，只翻译标签之间的文字。

本地化表和自定义显示字段还可能含格式占位符，例如 `{0}`、`{0:N0}`、`{basePower:0}`、`{player:INT}`。保留占位符及其格式参数，结合消费代码确认语法，按 `text-preserve` 设置保护。

# 字体

TextMeshPro 字体资产缺少中文字形时，译文显示为方框。按以下顺序检查：

- 游戏运行日志 `Player.log` 中的缺字警告，含缺失码点、字体资产名和文本对象名。
- 目标字体的 `fallbackFontAssetTable` 与全局 `TMP_Settings`，包内已有中文字体资产时加入后备链。
- 静态字体检查预烘焙的字符表与图集，动态字体检查 `atlasPopulationMode` 与源字体文件的字符覆盖。
